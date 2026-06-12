import {
    FluidityPacket,
    FormattedData,
    isFluidityLink,
    stripControlChars,
    decodeSuggestStyle
} from '#@shared/types.js';
import { TermCaps } from './caps.js';
import { paint, styleDef, chromeDef, StyleDef } from './theme.js';
import { padEndAnsi, padStartAnsi } from './ansiText.js';

export interface RenderOpts {
    caps: TermCaps;
    showUrls?: boolean;
    //tests pin these for determinism; omitted = host locale/zone (web parity)
    timeZone?: string;
    locale?: string;
}

const timeOpts = (timeZone?: string): Intl.DateTimeFormatOptions => (timeZone ? { timeZone } : {});

//Intl.DateTimeFormat construction is expensive and connect renders the whole
//history (4000 packets by default), so formatters are cached per locale+zone:
//one shape for the line timestamp (full time), one for DATE fields (HH:MM)
const fmtCache = new Map<string, Intl.DateTimeFormat>();

const timeFormatter = (kind: 'clock' | 'date', locale?: string, timeZone?: string): Intl.DateTimeFormat => {
    const key = `${kind}|${locale ?? ''}|${timeZone ?? ''}`;
    let fmt = fmtCache.get(key);
    if (!fmt) {
        const shape: Intl.DateTimeFormatOptions =
            kind === 'clock'
                ? { hour: 'numeric', minute: 'numeric', second: 'numeric' }
                : { hour: '2-digit', minute: '2-digit' };
        fmt = new Intl.DateTimeFormat(locale ?? [], { ...shape, ...timeOpts(timeZone) });
        fmtCache.set(key, fmt);
    }
    return fmt;
};

//never render the literal "Invalid Date" (web parity: ui.ts safeTime)
const safeFormat = (fmt: Intl.DateTimeFormat, value: string): string => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? fmt.format(d) : '--:--';
};

//the web client's trim convention: styles >= 100 mean color (style % 10), no
//spacing - decoded by the shared helper; the ANSI mapping stays local
const fieldStyle = (suggestStyle: number): { def: StyleDef; trim: boolean } => {
    const { color, trim } = decodeSuggestStyle(suggestStyle);
    return { def: styleDef(color), trim };
};

//serial payloads are untrusted: strip control chars (C0, DEL, and C1) so
//stray \r (or worse, embedded escape sequences) can't corrupt or inject
//into the terminal

const sanitize = stripControlChars;

const asText = (v: FormattedData['field']): string => (typeof v === 'string' ? v : JSON.stringify(v));

const renderField = (f: FormattedData, o: RenderOpts): { text: string; trim: boolean } => {
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
                //defensive: a malformed link is dumped as JSON, but JSON.stringify
                //escapes only C0 - DEL/C1 bytes pass through - so sanitize it too
                return { text: paint(sanitize(JSON.stringify(f.field)), def, tier), trim };
            }
            //the location feeds an OSC 8 sequence: sanitize so an embedded
            //BEL/ESC can't terminate the hyperlink early or inject
            const location = sanitize(f.field.location);
            const name = paint(sanitize(f.field.name), { ...def, underline: tier !== 'mono' }, tier);
            const linked = o.caps.hyperlinks ? `\x1b]8;;${location}\x07${name}\x1b]8;;\x07` : name;
            return {
                text: o.showUrls ? `${linked} (${location})` : linked,
                trim
            };
        }

        default:
            //an out-of-union fieldType: same defensive sanitize as the bad-LINK path
            return { text: paint(sanitize(JSON.stringify(f.field)), styleDef(0), tier), trim: false };
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
        time: safeFormat(timeFormatter('clock', o.locale, o.timeZone), p.ts),
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

    //padding is column-aware (padStartAnsi/padEndAnsi), so CJK/emoji site
    //names (2 columns per glyph) keep the field columns aligned
    return (
        c('bracket', '[') +
        c('timestamp', pad ? padStartAnsi(parts.time, pad.time) : parts.time) +
        c('bracket', ']') +
        ' ' +
        c('site', pad ? padEndAnsi(parts.site.toUpperCase(), pad.site) : parts.site.toUpperCase()) +
        c('separator', '(') +
        c('description', pad ? padEndAnsi(parts.desc.toLowerCase(), pad.desc) : parts.desc.toLowerCase()) +
        c('separator', '):') +
        parts.fields
    );
};

export const renderLine = (p: FluidityPacket, o: RenderOpts): string => composeChrome(renderParts(p, o), o);
