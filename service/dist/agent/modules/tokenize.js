import { isObject, stripControlChars } from '#@shared/types.js';
const FORMATS = ['auto', 'json', 'logfmt', 'syslog', 'levelmsg', 'raw'];
const STYLE = { error: 6, warn: 9, info: 0, debug: 7, source: 2, link: 3, kv: 7, msg: 0 };
const TOKENIZE_MAX_LEN = 2000;
const MAX_FIELDS = 16;
const MAX_KV = 10;
const VALUE_CLIP = 256;
const LEVEL_RE = /\b(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|ERR|FATAL|CRITICAL|CRIT|ALERT|EMERG|PANIC)\b/i;
const TS_ISO = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)/;
const URL_RE = /https?:\/\/[^\s<>"']{1,512}/g;
const KV_RE = /([A-Za-z_][\w.\-]{0,64})=("[^"]{0,512}"|[^\s"]{0,512})/g;
const SYSLOG_RE = /^(?:<\d{1,3}>)?([A-Z][a-z]{2}\s+\d{1,2}\s\d{2}:\d{2}:\d{2})\s(\S{1,255})\s([^\s:[]{1,64})(?:\[(\d{1,10})\])?:\s?(.*)$/;
const PICK_TS = ['ts', 'time', 'timestamp', '@timestamp', 't'];
const PICK_LEVEL = ['level', 'lvl', 'severity', 'levelname', 'loglevel'];
const PICK_MSG = ['msg', 'message', 'text', 'event'];
const levelStyle = (lvl) => {
    const u = lvl.toUpperCase();
    if (u === 'TRACE' || u === 'DEBUG')
        return STYLE.debug;
    if (u === 'INFO' || u === 'NOTICE')
        return STYLE.info;
    if (u === 'WARN' || u === 'WARNING')
        return STYLE.warn;
    return STYLE.error;
};
const strField = (field, suggestStyle) => ({ suggestStyle, field, fieldType: 'STRING' });
const dateField = (field) => ({ suggestStyle: STYLE.debug, field, fieldType: 'DATE' });
const linkField = (url, fallbackStyle) => /^https?:\/\//i.test(url) && stripControlChars(url) === url
    ? { suggestStyle: STYLE.link, field: { name: url, location: url }, fieldType: 'LINK' }
    : strField(url, fallbackStyle);
const clip = (s) => (s.length > VALUE_CLIP ? `${s.slice(0, VALUE_CLIP)}…` : s);
const splitUrls = (text, style, out) => {
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
        const i = m.index ?? 0;
        if (i > last)
            out.push(strField(text.slice(last, i), style));
        out.push(linkField(m[0], style));
        last = i + m[0].length;
    }
    if (last < text.length)
        out.push(strField(text.slice(last), style));
};
const assembleStructured = (entries) => {
    const out = [];
    const find = (keys) => entries.find(([k]) => keys.includes(k.toLowerCase()));
    const tsE = find(PICK_TS);
    const lvlE = find(PICK_LEVEL);
    const msgE = find(PICK_MSG);
    const style = lvlE ? levelStyle(lvlE[1]) : STYLE.msg;
    if (tsE) {
        out.push(Number.isFinite(new Date(tsE[1]).getTime()) ? dateField(tsE[1]) : strField(tsE[1], STYLE.debug));
    }
    if (lvlE)
        out.push(strField(lvlE[1].toUpperCase(), style));
    if (msgE)
        splitUrls(msgE[1], style, out);
    const shown = new Set([tsE, lvlE, msgE].filter((e) => e !== undefined).map(e => e[0]));
    let extra = 0;
    for (const [k, v] of entries) {
        if (shown.has(k) || out.length >= MAX_FIELDS || extra >= MAX_KV)
            continue;
        out.push(strField(`${k}=${clip(v)}`, STYLE.kv));
        extra++;
    }
    return out.length ? out : [strField(entries.map(([k, v]) => `${k}=${v}`).join(' '), STYLE.msg)];
};
const tokenizeJson = (line) => {
    let obj;
    try {
        obj = JSON.parse(line);
    }
    catch {
        return null;
    }
    if (!isObject(obj) || Array.isArray(obj))
        return null;
    const rec = obj;
    const entries = Object.keys(rec).map(k => {
        const v = rec[k];
        if (PICK_TS.includes(k.toLowerCase()) && typeof v === 'number') {
            const ms = v < 1e12 ? v * 1000 : v;
            const d = new Date(ms);
            if (Number.isFinite(d.getTime()))
                return [k, d.toISOString()];
        }
        return [k, typeof v === 'string' ? v : JSON.stringify(v)];
    });
    return assembleStructured(entries);
};
const unquote = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
const looksLikeLogfmt = (line) => {
    const m = line.match(KV_RE);
    return m !== null && m.length >= 2 && /^\s*[A-Za-z_][\w.\-]*=/.test(line);
};
const tokenizeLogfmt = (line) => {
    const entries = [...line.matchAll(KV_RE)].map(m => [m[1], unquote(m[2])]);
    return entries.length ? assembleStructured(entries) : null;
};
const tokenizeSyslog = (line) => {
    const m = SYSLOG_RE.exec(line);
    if (!m)
        return null;
    const [, ts, host, tag, , msg] = m;
    const out = [strField(ts, STYLE.debug), strField(`${host} ${tag}`, STYLE.source)];
    out.push(...tokenizeLevelMsg(msg ?? ''));
    return out;
};
const tokenizeLevelMsg = (line) => {
    const out = [];
    let rest = line;
    const tsm = TS_ISO.exec(rest);
    if (tsm && tsm[1]) {
        out.push(dateField(tsm[1]));
        rest = rest.slice(tsm[0].length).replace(/^\s+/, '');
    }
    const lvl = LEVEL_RE.exec(rest);
    const style = lvl && lvl[1] ? levelStyle(lvl[1]) : STYLE.msg;
    if (rest.length)
        splitUrls(rest, style, out);
    return out.length ? out : [strField(line, STYLE.msg)];
};
const detect = (line) => {
    if (line.trimStart().startsWith('{'))
        return 'json';
    if (SYSLOG_RE.test(line))
        return 'syslog';
    if (looksLikeLogfmt(line))
        return 'logfmt';
    return 'levelmsg';
};
export const tokenize = (line, cfg) => {
    if (line.length > cfg.maxLen)
        return [strField(line, STYLE.msg)];
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
    let out;
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
    return out && out.length ? out.slice(0, MAX_FIELDS) : tokenizeLevelMsg(line);
};
export const parseTokenizeConfig = (raw, defaultOn, label) => {
    const base = { enabled: defaultOn, format: 'auto', rules: [], maxLen: TOKENIZE_MAX_LEN };
    if (raw === undefined)
        return base;
    if (typeof raw === 'boolean')
        return { ...base, enabled: raw };
    if (!isObject(raw))
        throw new Error(`${label}: tokenize must be a boolean or an object`);
    const o = raw;
    const cfg = { ...base, enabled: true };
    if (o['enabled'] !== undefined) {
        if (typeof o['enabled'] !== 'boolean')
            throw new Error(`${label}: tokenize.enabled must be a boolean`);
        cfg.enabled = o['enabled'];
    }
    if (o['format'] !== undefined) {
        if (typeof o['format'] !== 'string' || !FORMATS.includes(o['format'])) {
            throw new Error(`${label}: tokenize.format must be one of ${FORMATS.join(', ')}`);
        }
        cfg.format = o['format'];
    }
    if (o['maxLen'] !== undefined) {
        if (typeof o['maxLen'] !== 'number' || !Number.isInteger(o['maxLen']) || o['maxLen'] < 1) {
            throw new Error(`${label}: tokenize.maxLen must be a positive integer`);
        }
        cfg.maxLen = o['maxLen'];
    }
    if (o['rules'] !== undefined) {
        if (!Array.isArray(o['rules']))
            throw new Error(`${label}: tokenize.rules must be an array`);
        cfg.rules = o['rules'].map((r, i) => {
            if (!isObject(r))
                throw new Error(`${label}: tokenize.rules[${i}] must be an object`);
            const rr = r;
            if (typeof rr['match'] !== 'string')
                throw new Error(`${label}: tokenize.rules[${i}].match must be a string`);
            if (typeof rr['style'] !== 'number' || !Number.isFinite(rr['style'])) {
                throw new Error(`${label}: tokenize.rules[${i}].style must be a finite number`);
            }
            const ft = rr['fieldType'];
            if (ft !== undefined && ft !== 'STRING' && ft !== 'LINK' && ft !== 'DATE') {
                throw new Error(`${label}: tokenize.rules[${i}].fieldType must be STRING, LINK, or DATE`);
            }
            let re;
            try {
                re = new RegExp(rr['match']);
            }
            catch (e) {
                throw new Error(`${label}: tokenize.rules[${i}].match is not a valid regex: ${e.message}`);
            }
            return ft === undefined ? { re, style: rr['style'] } : { re, style: rr['style'], fieldType: ft };
        });
    }
    return cfg;
};
export const toFields = (line, cfg) => cfg.enabled ? tokenize(line, cfg) : [strField(line, STYLE.msg)];
