//ANSI-aware text measurement and truncation for viewport clipping

const SGR = /^\x1b\[[0-9;]*m/;

export const visibleLength = (s: string): number => {
    let len = 0;
    let i = 0;
    while (i < s.length) {
        const m = SGR.exec(s.slice(i));
        if (m) {
            i += m[0].length;
            continue;
        }
        if (s[i] === '\x1b') {
            //unknown escape: skip the introducer so it can't count as visible
            i++;
            continue;
        }
        len++;
        i++;
    }
    return len;
};

//clip to width visible columns, preserving SGR sequences and ending with a reset
export const truncateAnsi = (s: string, width: number): string => {
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

export const padEndAnsi = (s: string, width: number): string => {
    const len = visibleLength(s);
    return len >= width ? truncateAnsi(s, width) : s + ' '.repeat(width - len);
};
