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
export const renderParts = (p, o) => {
    let fields = '';
    for (const f of p.formattedData) {
        const { text, trim } = renderField(f, o);
        fields += trim ? text : ` ${text}`;
    }
    return {
        time: new Date(p.ts).toLocaleTimeString(o.locale ?? [], timeOpts(o.timeZone)),
        site: sanitize(p.site),
        desc: sanitize(p.description),
        fields
    };
};
export const composeChrome = (parts, o, pad) => {
    const tier = o.caps.tier;
    const c = (role, text) => paint(text, chromeDef(role), tier);
    return (c('bracket', '[') +
        c('timestamp', pad ? parts.time.padStart(pad.time) : parts.time) +
        c('bracket', ']') +
        ' ' +
        c('site', pad ? parts.site.toUpperCase().padEnd(pad.site) : parts.site.toUpperCase()) +
        c('separator', '(') +
        c('description', pad ? parts.desc.toLowerCase().padEnd(pad.desc) : parts.desc.toLowerCase()) +
        c('separator', '):') +
        parts.fields);
};
export const renderLine = (p, o) => composeChrome(renderParts(p, o), o);
//# sourceMappingURL=renderLine.js.map