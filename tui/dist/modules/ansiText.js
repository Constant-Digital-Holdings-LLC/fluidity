const SGR = /^\x1b\[[0-9;]*m/;
export const visibleLength = (s) => {
    let len = 0;
    let i = 0;
    while (i < s.length) {
        const m = SGR.exec(s.slice(i));
        if (m) {
            i += m[0].length;
            continue;
        }
        if (s[i] === '\x1b') {
            i++;
            continue;
        }
        len++;
        i++;
    }
    return len;
};
export const truncateAnsi = (s, width) => {
    let out = '';
    let len = 0;
    let i = 0;
    let sawSgr = false;
    while (i < s.length && len < width) {
        const m = SGR.exec(s.slice(i));
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
        out += s[i];
        len++;
        i++;
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
//# sourceMappingURL=ansiText.js.map