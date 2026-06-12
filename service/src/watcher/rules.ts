//Watcher rule schema, parsing, and selector matching. Pure: no I/O, no exec -
//so it unit-tests cleanly and both the matcher and the runner share one
//vocabulary. Misconfiguration throws here at parse time (the collector
//doctrine: degrade loudly at startup, never warn-and-run-broken).

import { FluidityPacket, isObject } from '#@shared/types.js';

export type FireReason = 'match' | 'silence' | 'recover';

export interface RuleSelector {
    site?: string;
    plugin?: string;
    text?: RegExp;
}

export type RuleTrigger =
    | { type: 'silence'; windowMs: number }
    | { type: 'frequency'; count: number; windowMs: number };

export interface ParsedRule {
    name: string;
    selector: RuleSelector;
    trigger: RuleTrigger;
    recover: boolean;
    exec: string;
    args: string[];
    message: string;
    format: 'text' | 'json';
    cooldownMs: number;
    maxPerHour: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_PER_HOUR = 12;
//selector regex never runs against more than this many chars (ReDoS bound -
//the same discipline as the tokenizer; rules are operator-authored but a
//hostile log line is not)
export const SELECTOR_TEXT_CAP = 4000;

const DURATION_RE = /^(\d+)(ms|s|m|h)$/;
export const parseDuration = (raw: unknown, where: string): number => {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw; //already ms
    if (typeof raw !== 'string') throw new Error(`${where}: duration must be like "120s"/"10m"/"2h"/"500ms"`);
    const m = DURATION_RE.exec(raw.trim());
    if (!m) throw new Error(`${where}: invalid duration "${raw}" (use 120s / 10m / 2h / 500ms)`);
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
    return n * mult;
};

//the text a selector's regex (and the {{text}} template / FLU_TEXT) sees: the
//field values joined, capped for ReDoS safety
export const joinedText = (p: FluidityPacket): string => {
    const parts = p.formattedData.map(f => {
        const v = f.field;
        if (typeof v === 'string') return v;
        return `${v.name} ${v.location}`; //a LINK
    });
    return parts.join(' ').slice(0, SELECTOR_TEXT_CAP);
};

export const matchesSelector = (sel: RuleSelector, p: FluidityPacket): boolean => {
    if (sel.site !== undefined && p.site !== sel.site) return false;
    if (sel.plugin !== undefined && p.plugin !== sel.plugin) return false;
    if (sel.text !== undefined && !sel.text.test(joinedText(p))) return false;
    return true;
};

const asString = (v: unknown, where: string): string => {
    if (typeof v !== 'string' || !v) throw new Error(`${where} must be a non-empty string`);
    return v;
};

const parseSelector = (raw: unknown, where: string): RuleSelector => {
    if (!isObject(raw)) throw new Error(`${where}.match must be an object`);
    const o = raw as Record<string, unknown>;
    const sel: RuleSelector = {};
    if (o['site'] !== undefined) sel.site = asString(o['site'], `${where}.match.site`);
    if (o['plugin'] !== undefined) sel.plugin = asString(o['plugin'], `${where}.match.plugin`);
    if (o['text'] !== undefined) {
        if (typeof o['text'] !== 'string') throw new Error(`${where}.match.text must be a string regex`);
        try {
            sel.text = new RegExp(o['text']); //no /g: test() must stay stateless
        } catch (e) {
            throw new Error(`${where}.match.text is not a valid regex: ${(e as Error).message}`);
        }
    }
    if (sel.site === undefined && sel.plugin === undefined && sel.text === undefined) {
        throw new Error(`${where}.match needs at least one of site/plugin/text (a rule must not match everything)`);
    }
    return sel;
};

const parseTrigger = (raw: unknown, where: string): RuleTrigger => {
    if (!isObject(raw)) throw new Error(`${where}.trigger must be an object`);
    const o = raw as Record<string, unknown>;
    const type = o['type'];
    if (type === 'silence') {
        return { type: 'silence', windowMs: parseDuration(o['window'], `${where}.trigger.window`) };
    }
    if (type === 'frequency') {
        const count = o['count'];
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
            throw new Error(`${where}.trigger.count must be an integer >= 1`);
        }
        return { type: 'frequency', count, windowMs: parseDuration(o['window'], `${where}.trigger.window`) };
    }
    throw new Error(`${where}.trigger.type must be "silence" or "frequency"`);
};

export interface ParseRulesOptions {
    //at startup, verify each exec path exists and is executable (off in unit
    //tests, which don't ship real programs)
    checkExec?: (path: string) => void;
}

//parse + validate the raw `alerts` array. enabled:false stanzas are dropped
//(returned in `skipped`), like the collector enabled flag.
export const parseRules = (raw: unknown, opts: ParseRulesOptions = {}): { rules: ParsedRule[]; skipped: string[] } => {
    if (raw === undefined) return { rules: [], skipped: [] };
    if (!Array.isArray(raw)) throw new Error('alerts must be an array');

    const rules: ParsedRule[] = [];
    const skipped: string[] = [];
    const names = new Set<string>();

    raw.forEach((r, i) => {
        const where = `alerts[${i}]`;
        if (!isObject(r)) throw new Error(`${where} must be an object`);
        const o = r as Record<string, unknown>;

        const name = asString(o['name'], `${where}.name`);
        if (names.has(name)) throw new Error(`${where}: duplicate rule name "${name}"`);
        names.add(name);

        if (o['enabled'] === false) {
            skipped.push(name);
            return;
        }

        const exec = asString(o['exec'], `${where}.exec`);
        opts.checkExec?.(exec);

        let args: string[] = [];
        if (o['args'] !== undefined) {
            if (!Array.isArray(o['args']) || !o['args'].every(a => typeof a === 'string')) {
                throw new Error(`${where}.args must be an array of strings`);
            }
            args = o['args'];
        }

        const format = o['format'] === undefined ? 'text' : o['format'];
        if (format !== 'text' && format !== 'json') throw new Error(`${where}.format must be "text" or "json"`);

        if (o['message'] !== undefined && typeof o['message'] !== 'string') {
            throw new Error(`${where}.message must be a string`);
        }
        const message = o['message'] ?? '{{rule}}: {{reason}} {{site}} {{text}}';

        let maxPerHour = DEFAULT_MAX_PER_HOUR;
        if (o['maxPerHour'] !== undefined) {
            if (typeof o['maxPerHour'] !== 'number' || !Number.isInteger(o['maxPerHour']) || o['maxPerHour'] < 1) {
                throw new Error(`${where}.maxPerHour must be an integer >= 1`);
            }
            maxPerHour = o['maxPerHour'];
        }

        rules.push({
            name,
            selector: parseSelector(o['match'], where),
            trigger: parseTrigger(o['trigger'], where),
            recover: o['recover'] === true,
            exec,
            args,
            message,
            format,
            cooldownMs:
                o['cooldown'] === undefined ? DEFAULT_COOLDOWN_MS : parseDuration(o['cooldown'], `${where}.cooldown`),
            maxPerHour
        });
    });

    return { rules, skipped };
};
