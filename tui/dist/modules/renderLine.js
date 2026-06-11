import { isFluidityLink } from '#@shared/types.js';
import { paint, styleDef, chromeDef } from './theme.js';
const timeOpts = (timeZone) => (timeZone ? { timeZone } : {});
const fieldStyle = (suggestStyle) => suggestStyle >= 100
    ? { def: styleDef(suggestStyle % 10), trim: true }
    : { def: styleDef(suggestStyle), trim: false };
const sanitize = (s) => s.replace(/[\x00-\x1f\x7f]/g, '');
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const renderField = (f, o) => {
    const { def, trim } = fieldStyle(f.suggestStyle);
    const tier = o.caps.tier;
    switch (f.fieldType) {
        case 'STRING':
            return { text: paint(sanitize(asText(f.field)), def, tier), trim };
        case 'DATE': {
            const t = new Date(asText(f.field)).toLocaleTimeString(o.locale ?? [], {
                hour: '2-digit',
                minute: '2-digit',
                ...timeOpts(o.timeZone)
            });
            return { text: paint(t, def, tier), trim };
        }
        case 'LINK': {
            if (!isFluidityLink(f.field)) {
                return { text: paint(JSON.stringify(f.field), def, tier), trim };
            }
            const name = paint(sanitize(f.field.name), { ...def, underline: tier !== 'mono' }, tier);
            const linked = o.caps.hyperlinks ? `\x1b]8;;${f.field.location}\x07${name}\x1b]8;;\x07` : name;
            return {
                text: o.showUrls ? `${linked} (${f.field.location})` : linked,
                trim
            };
        }
        default:
            return { text: paint(JSON.stringify(f.field), styleDef(0), tier), trim: false };
    }
};
export const renderLine = (p, o) => {
    const tier = o.caps.tier;
    const c = (role, text) => paint(text, chromeDef(role), tier);
    const ts = new Date(p.ts).toLocaleTimeString(o.locale ?? [], timeOpts(o.timeZone));
    let line = c('bracket', '[') +
        c('timestamp', ts) +
        c('bracket', ']') +
        ' ' +
        c('site', sanitize(p.site).toUpperCase()) +
        c('separator', '(') +
        c('description', sanitize(p.description).toLowerCase()) +
        c('separator', '):');
    for (const f of p.formattedData) {
        const { text, trim } = renderField(f, o);
        line += trim ? text : ` ${text}`;
    }
    return line;
};
//# sourceMappingURL=renderLine.js.map