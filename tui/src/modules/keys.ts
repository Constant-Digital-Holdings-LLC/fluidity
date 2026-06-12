//raw-mode keyboard input parsing - just the sequences the UI binds

export type KeyName =
    | 'quit' //q or ctrl-c
    | 'up'
    | 'down'
    | 'pageUp'
    | 'pageDown'
    | 'top' //g
    | 'bottom' //G (re-pins auto-scroll)
    | 'pause' //space
    | 'tab' //switch filter group
    | 'clear' //x
    | 'help' //?
    | 'window' //w - cycle the rate strip's time window
    | 'digit'
    | 'other';

export interface Key {
    name: KeyName;
    digit?: number;
}

export const parseKeys = (chunk: Buffer): Key[] => {
    const keys: Key[] = [];
    const s = chunk.toString('utf8');
    let i = 0;

    while (i < s.length) {
        const c = s[i] ?? '';

        if (c === '\x1b' && s[i + 1] === '[') {
            //CSI grammar (ECMA-48): ESC '[' parameter-bytes (0x30-0x3f),
            //intermediate-bytes (0x20-0x2f), one final byte (0x40-0x7e).
            //the whole sequence is consumed so parameter bytes of keys we
            //don't bind (Delete \x1b[3~, F5 \x1b[15~, Ctrl-Up \x1b[1;5A)
            //can't re-parse as digit/letter keystrokes
            let j = i + 2;
            while (j < s.length && s.charCodeAt(j) >= 0x30 && s.charCodeAt(j) <= 0x3f) j++;
            while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x2f) j++;
            if (j >= s.length) {
                //chunk ended mid-sequence: swallow the fragment, emit nothing
                i = s.length;
                continue;
            }
            const body = s.slice(i + 2, j);
            const final = s[j] ?? '';
            if (body === '' && (final === 'A' || final === 'B')) {
                keys.push({ name: final === 'A' ? 'up' : 'down' });
            } else if (final === '~' && (body === '5' || body === '6')) {
                keys.push({ name: body === '5' ? 'pageUp' : 'pageDown' });
            }
            //any other CSI sequence is consumed silently
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
            case '?':
                keys.push({ name: 'help' });
                break;
            default:
                if (c >= '1' && c <= '9') {
                    keys.push({ name: 'digit', digit: parseInt(c, 10) });
                } else {
                    keys.push({ name: 'other' });
                }
        }
        i++;
    }

    return keys;
};
