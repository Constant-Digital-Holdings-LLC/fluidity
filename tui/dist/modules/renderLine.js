import { isFluidityLink, stripControlChars, decodeSuggestStyle } from '#@shared/types.js';
import { paint, styleDef, chromeDef } from './theme.js';
import { padEndAnsi, padStartAnsi } from './ansiText.js';
const timeOpts = (timeZone) => (timeZone ? { timeZone } : {});
const fmtCache = new Map();
const timeFormatter = (kind, locale, timeZone) => {
    const key = `${kind}|${locale ?? ''}|${timeZone ?? ''}`;
    let fmt = fmtCache.get(key);
    if (!fmt) {
        const shape = kind === 'clock'
            ? { hour: 'numeric', minute: 'numeric', second: 'numeric' }
            : { hour: '2-digit', minute: '2-digit' };
        fmt = new Intl.DateTimeFormat(locale ?? [], { ...shape, ...timeOpts(timeZone) });
        fmtCache.set(key, fmt);
    }
    return fmt;
};
const safeFormat = (fmt, value) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? fmt.format(d) : '--:--';
};
const fieldStyle = (suggestStyle) => {
    const { color, trim } = decodeSuggestStyle(suggestStyle);
    return { def: styleDef(color), trim };
};
const sanitize = stripControlChars;
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const renderField = (f, o) => {
    const { def, trim } = fieldStyle(f.suggestStyle);
    const tier = o.caps.tier;
    switch (f.fieldType) {
        case 'STRING':
            return { text: paint(sanitize(asText(f.field)), def, tier), trim };
        case 'DATE': {
            const t = safeFormat(timeFormatter('date', o.locale, o.timeZone), asText(f.field));
            return { text: paint(t, def, tier), trim };
        }
        case 'LINK': {
            if (!isFluidityLink(f.field)) {
                return { text: paint(sanitize(JSON.stringify(f.field)), def, tier), trim };
            }
            const location = sanitize(f.field.location);
            const name = paint(sanitize(f.field.name), { ...def, underline: tier !== 'mono' }, tier);
            const linked = o.caps.hyperlinks ? `\x1b]8;;${location}\x07${name}\x1b]8;;\x07` : name;
            return {
                text: o.showUrls ? `${linked} (${location})` : linked,
                trim
            };
        }
        default:
            return { text: paint(sanitize(JSON.stringify(f.field)), styleDef(0), tier), trim: false };
    }
};
export const renderParts = (p, o) => {
    let fields = '';
    for (const f of p.formattedData) {
        const { text, trim } = renderField(f, o);
        fields += trim ? text : ` ${text}`;
    }
    return {
        time: safeFormat(timeFormatter('clock', o.locale, o.timeZone), p.ts),
        site: sanitize(p.site),
        desc: sanitize(p.description),
        fields
    };
};
export const composeChrome = (parts, o, pad) => {
    const tier = o.caps.tier;
    const c = (role, text) => paint(text, chromeDef(role), tier);
    return (c('bracket', '[') +
        c('timestamp', pad ? padStartAnsi(parts.time, pad.time) : parts.time) +
        c('bracket', ']') +
        ' ' +
        c('site', pad ? padEndAnsi(parts.site.toUpperCase(), pad.site) : parts.site.toUpperCase()) +
        c('separator', '(') +
        c('description', pad ? padEndAnsi(parts.desc.toLowerCase(), pad.desc) : parts.desc.toLowerCase()) +
        c('separator', '):') +
        parts.fields);
};
export const renderLine = (p, o) => composeChrome(renderParts(p, o), o);
//# sourceMappingURL=renderLine.js.map