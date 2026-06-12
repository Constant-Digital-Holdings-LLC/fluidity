import { ColorTier } from './caps.js';

//suggestStyle palette - truecolor values are exact parity with
//client/dist/public/css/fluidity.css; the 16-color column is a deliberate
//mapping for the linux console (SPEC.md §4.1)

export interface StyleDef {
    readonly hex: string;
    readonly ansi16: number;
    readonly bold?: boolean;
    readonly dim?: boolean;
    readonly underline?: boolean;
}

const STYLES = [
    { hex: '#ffe5ff', ansi16: 97 }, //0 --light
    //1 & 5: muted mauves, lifted from #53354a/#472e40 (1.4-2.0:1 on the cells,
    //illegible) into the readable range; no longer dimmed, same as style 10
    { hex: '#a66e95', ansi16: 35 }, //1
    { hex: '#706c9d', ansi16: 34 }, //2
    { hex: '#54b0ed', ansi16: 94, bold: true }, //3 (web: bolder)
    { hex: '#00fdff', ansi16: 96 }, //4
    { hex: '#a7628b', ansi16: 35 }, //5
    { hex: '#fe95c6', ansi16: 95 }, //6
    { hex: '#999999', ansi16: 90 }, //7
    { hex: '#d2b48c', ansi16: 33 }, //8 tan
    { hex: '#ffdab9', ansi16: 93 }, //9 peachpuff
    //10 --dark, the quiet tone: lightened from #52423d (under 2:1 on black)
    //and no longer dimmed, so the 16-color tier can read it too
    { hex: '#7d6a5f', ansi16: 90 } //10 --dark
] as const satisfies readonly StyleDef[];

//packet chrome parity with fluidity.css (.site, .description, .bracket-*, .colon)
export type ChromeRole = 'timestamp' | 'bracket' | 'site' | 'description' | 'separator';

const CHROME: Record<ChromeRole, StyleDef> = {
    timestamp: STYLES[0],
    bracket: STYLES[2],
    site: STYLES[4],
    description: { ...STYLES[7], bold: true },
    separator: STYLES[2]
};

export const styleDef = (suggestStyle: number): StyleDef => STYLES[suggestStyle] ?? STYLES[0];

export const chromeDef = (role: ChromeRole): StyleDef => CHROME[role];

//nearest xterm-256 index for a hex color (6x6x6 cube + grayscale ramp)
export const hexTo256 = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;

    const cubeLevels = [0, 95, 135, 175, 215, 255];
    const nearestLevel = (v: number): number =>
        cubeLevels.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) ? l : best), 0);

    const cr = nearestLevel(r);
    const cg = nearestLevel(g);
    const cb = nearestLevel(b);
    const cubeIdx = 16 + 36 * cubeLevels.indexOf(cr) + 6 * cubeLevels.indexOf(cg) + cubeLevels.indexOf(cb);
    const cubeDist = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;

    const gray = Math.max(0, Math.min(23, Math.round((r * 0.299 + g * 0.587 + b * 0.114 - 8) / 10)));
    const gv = 8 + gray * 10;
    const grayDist = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;

    return grayDist < cubeDist ? 232 + gray : cubeIdx;
};

const RESET = '\x1b[0m';

const sgrCodes = (def: StyleDef, tier: ColorTier): string[] => {
    const codes: string[] = [];
    if (def.bold) codes.push('1');
    if (def.dim) codes.push('2');
    if (def.underline) codes.push('4');

    if (tier === 'truecolor') {
        const n = parseInt(def.hex.slice(1), 16);
        codes.push(`38;2;${(n >> 16) & 0xff};${(n >> 8) & 0xff};${n & 0xff}`);
    } else if (tier === '256') {
        codes.push(`38;5;${hexTo256(def.hex)}`);
    } else {
        codes.push(String(def.ansi16));
    }

    return codes;
};

export const paint = (text: string, def: StyleDef, tier: ColorTier): string => {
    if (tier === 'mono') {
        return text;
    }
    return `\x1b[${sgrCodes(def, tier).join(';')}m${text}${RESET}`;
};
