import { FluidityPacket, FormattedData, isFluidityLink } from '#@shared/types.js';
import { TermCaps } from './caps.js';
import { paint, styleDef, chromeDef, StyleDef } from './theme.js';

export interface RenderOpts {
    caps: TermCaps;
    showUrls?: boolean;
    //tests pin these for determinism; omitted = host locale/zone (web parity)
    timeZone?: string;
    locale?: string;
}

const timeOpts = (timeZone?: string): Intl.DateTimeFormatOptions => (timeZone ? { timeZone } : {});

//the web client's trim convention: styles >= 100 mean color (style % 10), no spacing
const fieldStyle = (suggestStyle: number): { def: StyleDef; trim: boolean } =>
    suggestStyle >= 100
        ? { def: styleDef(suggestStyle % 10), trim: true }
        : { def: styleDef(suggestStyle), trim: false };

//serial payloads are untrusted: strip control chars so stray \r (or worse,
//embedded escape sequences) can't corrupt or inject into the terminal

const sanitize = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, '');

const asText = (v: FormattedData['field']): string => (typeof v === 'string' ? v : JSON.stringify(v));

const renderField = (f: FormattedData, o: RenderOpts): { text: string; trim: boolean } => {
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

//the line decomposed so the interactive view can pad columns evenly:
//time/site/desc are plain (sanitized) text, fields is the styled tail
export interface RenderedParts {
    time: string;
    site: string;
    desc: string;
    fields: string;
}

export const renderParts = (p: FluidityPacket, o: RenderOpts): RenderedParts => {
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

//chrome parity with the web packet line, including its text transforms:
//[time] SITE(description): fields
export const composeChrome = (
    parts: RenderedParts,
    o: RenderOpts,
    pad?: { time: number; site: number; desc: number }
): string => {
    const tier = o.caps.tier;
    const c = (role: Parameters<typeof chromeDef>[0], text: string): string => paint(text, chromeDef(role), tier);

    return (
        c('bracket', '[') +
        c('timestamp', pad ? parts.time.padStart(pad.time) : parts.time) +
        c('bracket', ']') +
        ' ' +
        c('site', pad ? parts.site.toUpperCase().padEnd(pad.site) : parts.site.toUpperCase()) +
        c('separator', '(') +
        c('description', pad ? parts.desc.toLowerCase().padEnd(pad.desc) : parts.desc.toLowerCase()) +
        c('separator', '):') +
        parts.fields
    );
};

export const renderLine = (p: FluidityPacket, o: RenderOpts): string => composeChrome(renderParts(p, o), o);
