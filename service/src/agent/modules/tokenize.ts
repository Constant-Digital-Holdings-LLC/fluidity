//Shared line tokenizer (L2). Turns one log/console line into styled
//FormattedData fields, *suggesting* fieldType/suggestStyle per token - the
//clients still decide CSS vs ANSI. Used by logTail (on by default) and
//genericSerial (opt-in via extendedOptions.tokenize). Pure over FormattedData,
//imports only shared types, so there is no cycle with collectors.ts.
//
//Untrusted input: logs are attacker-influenced, so the line is capped before
//any matching runs and the built-in detectors are anchored/length-bounded. The
//one un-vetted pattern is an operator's tokenize.rules[].match - a vulnerable
//one would catastrophically backtrack on hostile content - so parse rejects the
//common nested-quantifier shape at startup (isCatastrophicRegex). The renderers
//sanitize control chars; we additionally refuse to emit a LINK whose location
//isn't a clean http(s) URL, since the server validates LINK fields and would
//400 the whole packet otherwise.

import { FormattedData, isObject, stripControlChars } from '#@shared/types.js';
import { isCatastrophicRegex } from '#@shared/modules/utils.js';

export type TokenFieldType = 'STRING' | 'LINK' | 'DATE';
export type TokenizeFormat = 'auto' | 'json' | 'logfmt' | 'syslog' | 'levelmsg' | 'raw';
const FORMATS: TokenizeFormat[] = ['auto', 'json', 'logfmt', 'syslog', 'levelmsg', 'raw'];

//category -> palette slot (PLAN.md L2 table). Level coloring is the anchor;
//the rest are secondary. >=100 would add the trim convention but we keep
//per-segment fields untrimmed (trim is for a single long field).
const STYLE = { error: 6, warn: 9, info: 0, debug: 7, source: 2, link: 3, kv: 7, msg: 0 } as const;

//cap a line before any regex runs - a pathological 1MB line must not be fed to
//a backtracking matcher (the file-tail source already bounds line length too)
const TOKENIZE_MAX_LEN = 2000;
//packet field bounds, so one absurd line can't produce hundreds of fields
const MAX_FIELDS = 16;
const MAX_KV = 10;
const VALUE_CLIP = 256;

export interface TokenizeRule {
    re: RegExp;
    style: number;
    fieldType?: TokenFieldType;
}
export interface TokenizeConfig {
    enabled: boolean;
    format: TokenizeFormat;
    rules: TokenizeRule[];
    maxLen: number;
}

//--- bounded token patterns -------------------------------------------------
const LEVEL_RE = /\b(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|ERR|FATAL|CRITICAL|CRIT|ALERT|EMERG|PANIC)\b/i;
//ISO-8601 at the start of the line (the only form we promote to DATE, since
//the client must be able to parse it; other timestamps stay styled strings)
const TS_ISO = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)/;
const URL_RE = /https?:\/\/[^\s<>"']{1,512}/g;
//logfmt / json-rest key=value: bounded value (quoted or bare), no nested
//unbounded quantifiers, so no catastrophic backtracking
const KV_RE = /([A-Za-z_][\w.\-]{0,64})=("[^"]{0,512}"|[^\s"]{0,512})/g;
//BSD syslog: `Mon DD HH:MM:SS host tag[pid]: message` (PRI optional)
const SYSLOG_RE =
    /^(?:<\d{1,3}>)?([A-Z][a-z]{2}\s+\d{1,2}\s\d{2}:\d{2}:\d{2})\s(\S{1,255})\s([^\s:[]{1,64})(?:\[(\d{1,10})\])?:\s?(.*)$/;

const PICK_TS = ['ts', 'time', 'timestamp', '@timestamp', 't'];
const PICK_LEVEL = ['level', 'lvl', 'severity', 'levelname', 'loglevel'];
const PICK_MSG = ['msg', 'message', 'text', 'event'];

const levelStyle = (lvl: string): number => {
    const u = lvl.toUpperCase();
    if (u === 'TRACE' || u === 'DEBUG') return STYLE.debug;
    if (u === 'INFO' || u === 'NOTICE') return STYLE.info;
    if (u === 'WARN' || u === 'WARNING') return STYLE.warn;
    return STYLE.error; //ERR/ERROR/FATAL/CRIT(ICAL)/ALERT/EMERG/PANIC
};

const strField = (field: string, suggestStyle: number): FormattedData => ({ suggestStyle, field, fieldType: 'STRING' });
const dateField = (field: string): FormattedData => ({ suggestStyle: STYLE.debug, field, fieldType: 'DATE' });
//only a clean http(s) URL becomes a LINK; anything else stays a styled STRING
//(the server's isFluidityLink rejects non-http / control-bearing locations,
//which would 400 the packet)
const linkField = (url: string, fallbackStyle: number): FormattedData =>
    /^https?:\/\//i.test(url) && stripControlChars(url) === url
        ? { suggestStyle: STYLE.link, field: { name: url, location: url }, fieldType: 'LINK' }
        : strField(url, fallbackStyle);

const clip = (s: string): string => (s.length > VALUE_CLIP ? `${s.slice(0, VALUE_CLIP)}…` : s);

//split text into message STRING segments + clickable URL LINKs, all in order
const splitUrls = (text: string, style: number, out: FormattedData[]): void => {
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
        const i = m.index ?? 0;
        if (i > last) out.push(strField(text.slice(last, i), style));
        out.push(linkField(m[0], style));
        last = i + m[0].length;
    }
    if (last < text.length) out.push(strField(text.slice(last), style));
};

//structured records (json object, logfmt pairs) share this: promote ts/level/
//msg, dim the remaining key=value pairs
const assembleStructured = (entries: [string, string][]): FormattedData[] => {
    const out: FormattedData[] = [];
    const find = (keys: string[]): [string, string] | undefined =>
        entries.find(([k]) => keys.includes(k.toLowerCase()));

    const tsE = find(PICK_TS);
    const lvlE = find(PICK_LEVEL);
    const msgE = find(PICK_MSG);
    const style = lvlE ? levelStyle(lvlE[1]) : STYLE.msg;

    if (tsE) {
        out.push(Number.isFinite(new Date(tsE[1]).getTime()) ? dateField(tsE[1]) : strField(tsE[1], STYLE.debug));
    }
    if (lvlE) out.push(strField(lvlE[1].toUpperCase(), style));
    if (msgE) splitUrls(msgE[1], style, out);

    const shown = new Set([tsE, lvlE, msgE].filter((e): e is [string, string] => e !== undefined).map(e => e[0]));
    let extra = 0;
    for (const [k, v] of entries) {
        if (shown.has(k) || out.length >= MAX_FIELDS || extra >= MAX_KV) continue;
        out.push(strField(`${k}=${clip(v)}`, STYLE.kv));
        extra++;
    }
    return out.length ? out : [strField(entries.map(([k, v]) => `${k}=${v}`).join(' '), STYLE.msg)];
};

//--- per-format tokenizers (return null to fall through to levelmsg) ---------
const tokenizeJson = (line: string): FormattedData[] | null => {
    let obj: unknown;
    try {
        obj = JSON.parse(line);
    } catch {
        return null;
    }
    if (!isObject(obj) || Array.isArray(obj)) return null;
    const rec = obj as Record<string, unknown>;

    const entries: [string, string][] = Object.keys(rec).map(k => {
        const v = rec[k];
        //promote a numeric epoch ts to ISO so it can render as a real DATE
        if (PICK_TS.includes(k.toLowerCase()) && typeof v === 'number') {
            const ms = v < 1e12 ? v * 1000 : v;
            const d = new Date(ms);
            if (Number.isFinite(d.getTime())) return [k, d.toISOString()];
        }
        return [k, typeof v === 'string' ? v : JSON.stringify(v)];
    });
    return assembleStructured(entries);
};

const unquote = (v: string): string => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

const looksLikeLogfmt = (line: string): boolean => {
    const m = line.match(KV_RE);
    return m !== null && m.length >= 2 && /^\s*[A-Za-z_][\w.\-]*=/.test(line);
};

const tokenizeLogfmt = (line: string): FormattedData[] | null => {
    const entries: [string, string][] = [...line.matchAll(KV_RE)].map(m => [m[1] as string, unquote(m[2] as string)]);
    return entries.length ? assembleStructured(entries) : null;
};

const tokenizeSyslog = (line: string): FormattedData[] | null => {
    const m = SYSLOG_RE.exec(line);
    if (!m) return null;
    const [, ts, host, tag, , msg] = m;
    const out: FormattedData[] = [strField(ts as string, STYLE.debug), strField(`${host} ${tag}`, STYLE.source)];
    out.push(...tokenizeLevelMsg(msg ?? ''));
    return out;
};

//the universal one: a leading ISO timestamp -> DATE, the message colored by
//its detected level, URLs split out as clickable LINKs. A line with nothing
//recognizable returns exactly one STRING at style 0 - the graceful fallback.
const tokenizeLevelMsg = (line: string): FormattedData[] => {
    const out: FormattedData[] = [];
    let rest = line;

    const tsm = TS_ISO.exec(rest);
    if (tsm && tsm[1]) {
        out.push(dateField(tsm[1]));
        rest = rest.slice(tsm[0].length).replace(/^\s+/, '');
    }

    const lvl = LEVEL_RE.exec(rest);
    const style = lvl && lvl[1] ? levelStyle(lvl[1]) : STYLE.msg;

    if (rest.length) splitUrls(rest, style, out);
    return out.length ? out : [strField(line, STYLE.msg)];
};

const detect = (line: string): TokenizeFormat => {
    if (line.trimStart().startsWith('{')) return 'json';
    if (SYSLOG_RE.test(line)) return 'syslog';
    if (looksLikeLogfmt(line)) return 'logfmt';
    return 'levelmsg';
};

export const tokenize = (line: string, cfg: TokenizeConfig): FormattedData[] => {
    //ReDoS guard: never feed an over-long line to the matchers
    if (line.length > cfg.maxLen) return [strField(line, STYLE.msg)];

    //user rules win, first match, whole-line coloring (the long-tail escape hatch)
    for (const r of cfg.rules) {
        if (r.re.test(line)) {
            return [
                r.fieldType === 'LINK'
                    ? linkField(line, r.style)
                    : { suggestStyle: r.style, field: line, fieldType: r.fieldType ?? 'STRING' }
            ];
        }
    }

    const fmt = cfg.format === 'auto' ? detect(line) : cfg.format;
    let out: FormattedData[] | null;
    switch (fmt) {
        case 'json':
            out = tokenizeJson(line);
            break;
        case 'logfmt':
            out = tokenizeLogfmt(line);
            break;
        case 'syslog':
            out = tokenizeSyslog(line);
            break;
        case 'raw':
            out = [strField(line, STYLE.msg)];
            break;
        default:
            out = tokenizeLevelMsg(line);
    }
    //a format detector that bailed falls back to the universal tokenizer
    return out && out.length ? out.slice(0, MAX_FIELDS) : tokenizeLevelMsg(line);
};

//parse extendedOptions.tokenize. Misconfiguration throws at startup (loud, per
//the collector-config doctrine) rather than silently mis-rendering.
export const parseTokenizeConfig = (raw: unknown, defaultOn: boolean, label: string): TokenizeConfig => {
    const base: TokenizeConfig = { enabled: defaultOn, format: 'auto', rules: [], maxLen: TOKENIZE_MAX_LEN };
    if (raw === undefined) return base;
    if (typeof raw === 'boolean') return { ...base, enabled: raw };
    if (!isObject(raw)) throw new Error(`${label}: tokenize must be a boolean or an object`);

    const o = raw as Record<string, unknown>;
    const cfg: TokenizeConfig = { ...base, enabled: true };

    if (o['enabled'] !== undefined) {
        if (typeof o['enabled'] !== 'boolean') throw new Error(`${label}: tokenize.enabled must be a boolean`);
        cfg.enabled = o['enabled'];
    }
    if (o['format'] !== undefined) {
        if (typeof o['format'] !== 'string' || !FORMATS.includes(o['format'] as TokenizeFormat)) {
            throw new Error(`${label}: tokenize.format must be one of ${FORMATS.join(', ')}`);
        }
        cfg.format = o['format'] as TokenizeFormat;
    }
    if (o['maxLen'] !== undefined) {
        if (typeof o['maxLen'] !== 'number' || !Number.isInteger(o['maxLen']) || o['maxLen'] < 1) {
            throw new Error(`${label}: tokenize.maxLen must be a positive integer`);
        }
        cfg.maxLen = o['maxLen'];
    }
    if (o['rules'] !== undefined) {
        if (!Array.isArray(o['rules'])) throw new Error(`${label}: tokenize.rules must be an array`);
        cfg.rules = o['rules'].map((r, i): TokenizeRule => {
            if (!isObject(r)) throw new Error(`${label}: tokenize.rules[${i}] must be an object`);
            const rr = r as Record<string, unknown>;
            if (typeof rr['match'] !== 'string')
                throw new Error(`${label}: tokenize.rules[${i}].match must be a string`);
            if (isCatastrophicRegex(rr['match'])) {
                throw new Error(
                    `${label}: tokenize.rules[${i}].match has a nested unbounded quantifier ` +
                        `(catastrophic-backtracking risk on hostile log lines); simplify the pattern`
                );
            }
            if (typeof rr['style'] !== 'number' || !Number.isFinite(rr['style'])) {
                throw new Error(`${label}: tokenize.rules[${i}].style must be a finite number`);
            }
            const ft = rr['fieldType'];
            if (ft !== undefined && ft !== 'STRING' && ft !== 'LINK' && ft !== 'DATE') {
                throw new Error(`${label}: tokenize.rules[${i}].fieldType must be STRING, LINK, or DATE`);
            }
            let re: RegExp;
            try {
                re = new RegExp(rr['match']); //no /g: test() must stay stateless
            } catch (e) {
                throw new Error(`${label}: tokenize.rules[${i}].match is not a valid regex: ${(e as Error).message}`);
            }
            return ft === undefined ? { re, style: rr['style'] } : { re, style: rr['style'], fieldType: ft };
        });
    }
    return cfg;
};

//the format() entry both line collectors call: tokenize when enabled, else the
//raw whole line (exactly the pre-tokenizer behavior - adoption is risk-free)
export const toFields = (line: string, cfg: TokenizeConfig): FormattedData[] =>
    cfg.enabled ? tokenize(line, cfg) : [strField(line, STYLE.msg)];
