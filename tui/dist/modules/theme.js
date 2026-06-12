const STYLES = [
    { hex: '#ffe5ff', ansi16: 97 },
    { hex: '#a66e95', ansi16: 35 },
    { hex: '#706c9d', ansi16: 34 },
    { hex: '#54b0ed', ansi16: 94, bold: true },
    { hex: '#00fdff', ansi16: 96 },
    { hex: '#a7628b', ansi16: 35 },
    { hex: '#fe95c6', ansi16: 95 },
    { hex: '#999999', ansi16: 90 },
    { hex: '#d2b48c', ansi16: 33 },
    { hex: '#ffdab9', ansi16: 93 },
    { hex: '#7d6a5f', ansi16: 90 }
];
const CHROME = {
    timestamp: STYLES[0],
    bracket: STYLES[2],
    site: STYLES[4],
    description: { ...STYLES[7], bold: true },
    separator: STYLES[2]
};
export const styleDef = (suggestStyle) => STYLES[suggestStyle] ?? STYLES[0];
export const chromeDef = (role) => CHROME[role];
export const hexTo256 = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    const cubeLevels = [0, 95, 135, 175, 215, 255];
    const nearestLevel = (v) => cubeLevels.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) ? l : best), 0);
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
const sgrCodes = (def, tier) => {
    const codes = [];
    if (def.bold)
        codes.push('1');
    if (def.dim)
        codes.push('2');
    if (def.underline)
        codes.push('4');
    if (tier === 'truecolor') {
        const n = parseInt(def.hex.slice(1), 16);
        codes.push(`38;2;${(n >> 16) & 0xff};${(n >> 8) & 0xff};${n & 0xff}`);
    }
    else if (tier === '256') {
        codes.push(`38;5;${hexTo256(def.hex)}`);
    }
    else {
        codes.push(String(def.ansi16));
    }
    return codes;
};
export const paint = (text, def, tier) => {
    if (tier === 'mono') {
        return text;
    }
    return `\x1b[${sgrCodes(def, tier).join(';')}m${text}${RESET}`;
};
//# sourceMappingURL=theme.js.map