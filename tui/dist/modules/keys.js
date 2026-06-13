export const parseKeys = (chunk) => {
    const keys = [];
    const s = chunk.toString('utf8');
    let i = 0;
    while (i < s.length) {
        const c = s[i] ?? '';
        if (c === '\x1b' && s[i + 1] === '[') {
            let j = i + 2;
            while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f)
                j++;
            while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f)
                j++;
            if (j >= s.length) {
                i = s.length;
                continue;
            }
            const body = s.slice(i + 2, j);
            const final = s[j] ?? '';
            if (body === '' && (final === 'A' || final === 'B')) {
                keys.push({ name: final === 'A' ? 'up' : 'down' });
            }
            else if (final === '~' && (body === '5' || body === '6')) {
                keys.push({ name: body === '5' ? 'pageUp' : 'pageDown' });
            }
            i = j + 1;
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
            case 'v':
                keys.push({ name: 'heartbeats' });
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