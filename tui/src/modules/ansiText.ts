//ANSI-aware text measurement and truncation for viewport clipping
//
//widths are terminal COLUMNS, not UTF-16 code units: East Asian Wide /
//Fullwidth glyphs and emoji occupy two cells, and astral code points are two
//code units - both break frame alignment if counted naively

//sticky (/y) so the regex tests "an SGR sequence starts exactly here"
//against the original string - no per-character slicing (keeps scans O(n))
const SGR = /\x1b\[[0-9;]*m/y;

//the standard East Asian Wide/Fullwidth blocks plus common emoji - the
//ranges that render two columns wide on every terminal we target
export const isWideCodePoint = (cp: number): boolean =>
    (cp >= 0x1100 && cp <= 0x115f) || //hangul jamo
    (cp >= 0x2e80 && cp <= 0x303e) || //CJK radicals, kangxi, CJK punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || //hiragana .. CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || //CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || //CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || //yi
    (cp >= 0xac00 && cp <= 0xd7a3) || //hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || //CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || //CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || //fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || //fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1f64f) || //emoji & emoticons
    (cp >= 0x1f900 && cp <= 0x1faff) || //supplemental symbols
    (cp >= 0x20000 && cp <= 0x3fffd); //CJK ext B+

export const visibleLength = (s: string): number => {
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
            //unknown escape: skip the introducer so it can't count as visible
            i++;
            continue;
        }
        const cp = s.codePointAt(i) ?? 0;
        cols += isWideCodePoint(cp) ? 2 : 1;
        i += cp > 0xffff ? 2 : 1;
    }
    return cols;
};

//clip to width visible columns, preserving SGR sequences and ending with a
//reset; never splits a surrogate pair, and a wide glyph that would straddle
//the boundary is excluded rather than overflow the frame
export const truncateAnsi = (s: string, width: number): string => {
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
        if (cols + w > width) break;
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

export const padEndAnsi = (s: string, width: number): string => {
    const len = visibleLength(s);
    return len >= width ? truncateAnsi(s, width) : s + ' '.repeat(width - len);
};

export const padStartAnsi = (s: string, width: number): string => {
    const len = visibleLength(s);
    return len >= width ? s : ' '.repeat(width - len) + s;
};
