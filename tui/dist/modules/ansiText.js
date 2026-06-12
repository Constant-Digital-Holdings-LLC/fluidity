const SGR = /\x1b\[[0-9;]*m/y;
export const isWideCodePoint = (cp) => (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd);
export const visibleLength = (s) => {
    let cols = 0;
    let i = 0;
    while (i < s.length) {
        SGR.lastIndex = i;
        const m = SGR.exec(s);
        if (m) {
            i += m[0].length;
            continue;
        }
        if (s[i] === '\x1b') {
            i++;
            continue;
        }
        const cp = s.codePointAt(i) ?? 0;
        cols += isWideCodePoint(cp) ? 2 : 1;
        i += cp > 0xffff ? 2 : 1;
    }
    return cols;
};
export const truncateAnsi = (s, width) => {
    let out = '';
    let cols = 0;
    let i = 0;
    let sawSgr = false;
    while (i < s.length && cols < width) {
        SGR.lastIndex = i;
        const m = SGR.exec(s);
        if (m) {
            out += m[0];
            sawSgr = true;
            i += m[0].length;
            continue;
        }
        if (s[i] === '\x1b') {
            i++;
            continue;
        }
        const cp = s.codePointAt(i) ?? 0;
        const w = isWideCodePoint(cp) ? 2 : 1;
        if (cols + w > width)
            break;
        const units = cp > 0xffff ? 2 : 1;
        out += s.slice(i, i + units);
        cols += w;
        i += units;
    }
    if (i < s.length && sawSgr) {
        out += '\x1b[0m';
    }
    return out;
};
export const padEndAnsi = (s, width) => {
    const len = visibleLength(s);
    return len >= width ? truncateAnsi(s, width) : s + ' '.repeat(width - len);
};
export const padStartAnsi = (s, width) => {
    const len = visibleLength(s);
    return len >= width ? s : ' '.repeat(width - len) + s;
};
//# sourceMappingURL=ansiText.js.map