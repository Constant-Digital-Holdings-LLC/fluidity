export const parseKeys = (chunk) => {
    const keys = [];
    const s = chunk.toString('utf8');
    let i = 0;
    while (i < s.length) {
        const c = s[i] ?? '';
        if (c === '\x1b' && s[i + 1] === '[') {
            const code = s[i + 2] ?? '';
            const seq3 = { A: 'up', B: 'down' };
            if (seq3[code]) {
                keys.push({ name: seq3[code] });
                i += 3;
                continue;
            }
            if ((code === '5' || code === '6') && s[i + 3] === '~') {
                keys.push({ name: code === '5' ? 'pageUp' : 'pageDown' });
                i += 4;
                continue;
            }
            i += 2;
            continue;
        }
        switch (c) {
            case '\x03':
            case 'q':
                keys.push({ name: 'quit' });
                break;
            case 'k':
                keys.push({ name: 'up' });
                break;
            case 'j':
                keys.push({ name: 'down' });
                break;
            case 'g':
                keys.push({ name: 'top' });
                break;
            case 'G':
                keys.push({ name: 'bottom' });
                break;
            case ' ':
                keys.push({ name: 'pause' });
                break;
            case '\t':
                keys.push({ name: 'tab' });
                break;
            case 'x':
                keys.push({ name: 'clear' });
                break;
            case 'w':
                keys.push({ name: 'window' });
                break;
            case '?':
                keys.push({ name: 'help' });
                break;
            default:
                if (c >= '1' && c <= '9') {
                    keys.push({ name: 'digit', digit: parseInt(c, 10) });
                }
                else {
                    keys.push({ name: 'other' });
                }
        }
        i++;
    }
    return keys;
};
//# sourceMappingURL=keys.js.map