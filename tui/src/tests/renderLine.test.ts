import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FluidityPacket } from '#@shared/types.js';
import { renderLine, RenderOpts } from '../modules/renderLine.js';
import { TermCaps } from '../modules/caps.js';

const caps = (tier: TermCaps['tier'], hyperlinks = false): TermCaps => ({ tier, hyperlinks });
const opts = (tier: TermCaps['tier'], extra: Partial<RenderOpts> = {}): RenderOpts => ({
    caps: caps(tier),
    timeZone: 'UTC',
    locale: 'en-US',
    ...extra
});

const packet: FluidityPacket = {
    seq: 7,
    ts: '2026-06-11T13:30:38.068Z',
    site: 'Verdugo Pk',
    description: 'SRS1',
    plugin: 'srsSerial',
    formattedData: [
        { suggestStyle: 0, field: 'Radio States: ', fieldType: 'STRING' },
        { suggestStyle: 3, field: 'RB-2M:', fieldType: 'STRING' },
        { suggestStyle: 9, field: 'COR', fieldType: 'STRING' }
    ]
};

void test('mono output is plain text with web chrome transforms', () => {
    const line = renderLine(packet, opts('mono'));
    assert.equal(line, '[1:30:38 PM] VERDUGO PK(srs1): Radio States:  RB-2M: COR');
    assert.ok(!line.includes('\x1b'), 'mono must not contain escapes');
});

void test('16-color output styles every region', () => {
    const line = renderLine(packet, opts('16'));
    assert.equal(
        line,
        '\x1b[34m[\x1b[0m\x1b[97m1:30:38 PM\x1b[0m\x1b[34m]\x1b[0m ' +
            '\x1b[96mVERDUGO PK\x1b[0m\x1b[34m(\x1b[0m\x1b[1;90msrs1\x1b[0m\x1b[34m):\x1b[0m' +
            ' \x1b[97mRadio States: \x1b[0m \x1b[1;94mRB-2M:\x1b[0m \x1b[93mCOR\x1b[0m'
    );
});

void test('truecolor uses exact fluidity.css values', () => {
    const line = renderLine(packet, opts('truecolor'));
    assert.ok(line.includes('38;2;84;176;237'), 'style 3 = #54b0ed');
    assert.ok(line.includes('38;2;255;218;185'), 'style 9 = peachpuff');
    assert.ok(line.includes('38;2;0;253;255'), 'site chrome = --color4');
});

void test('trim convention (style >= 100) omits the field separator', () => {
    const p: FluidityPacket = {
        ...packet,
        formattedData: [
            { suggestStyle: 0, field: 'a', fieldType: 'STRING' },
            { suggestStyle: 100, field: ',', fieldType: 'STRING' },
            { suggestStyle: 0, field: 'b', fieldType: 'STRING' }
        ]
    };
    const line = renderLine(p, opts('mono'));
    assert.ok(line.endsWith(' a, b'), `got: ${line}`);
});

void test('LINK fields: OSC 8 when supported, name-only otherwise, --show-urls appends', () => {
    const p: FluidityPacket = {
        ...packet,
        formattedData: [
            { suggestStyle: 6, field: { name: 'Test Net', location: 'https://ham.live/x' }, fieldType: 'LINK' }
        ]
    };

    const withOsc = renderLine(p, { ...opts('truecolor'), caps: caps('truecolor', true) });
    assert.ok(withOsc.includes('\x1b]8;;https://ham.live/x\x07'), 'OSC 8 open');

    const plain = renderLine(p, opts('mono'));
    assert.ok(plain.endsWith('Test Net'));
    assert.ok(!plain.includes('ham.live/x'), 'no URL unless requested');

    const withUrl = renderLine(p, { ...opts('mono'), showUrls: true });
    assert.ok(withUrl.endsWith('Test Net (https://ham.live/x)'));
});

void test('DATE fields render local HH:MM (web parity)', () => {
    const p: FluidityPacket = {
        ...packet,
        formattedData: [{ suggestStyle: 3, field: '2026-06-11T00:30:00.000Z', fieldType: 'DATE' }]
    };
    assert.ok(renderLine(p, opts('mono')).endsWith('12:30 AM'));
});

void test('untrusted field content is sanitized: no control chars or escape injection', () => {
    const p: FluidityPacket = {
        ...packet,
        site: 'Evil\x1b[2JSite',
        formattedData: [
            { suggestStyle: 0, field: 'line with trailing CR\r', fieldType: 'STRING' },
            { suggestStyle: 0, field: 'embedded \x1b[31minjection\x07', fieldType: 'STRING' }
        ]
    };
    const line = renderLine(p, opts('mono'));
    assert.ok(!line.includes('\r'), 'CR stripped');
    assert.ok(!line.includes('\x1b'), 'escape stripped');
    assert.ok(!line.includes('\x07'), 'BEL stripped');
    assert.ok(line.includes('EVIL[2JSITE'));
    assert.ok(line.includes('embedded [31minjection'));
});

void test('C1 controls (8-bit CSI/NEL) are stripped like C0', () => {
    const p: FluidityPacket = {
        ...packet,
        formattedData: [{ suggestStyle: 0, field: 'x\u009b31mY\u0085z', fieldType: 'STRING' }]
    };
    const line = renderLine(p, opts('mono'));
    assert.ok(!line.includes('\u009b'), '8-bit CSI stripped');
    assert.ok(!line.includes('\u0085'), 'NEL stripped');
    assert.ok(line.includes('x31mYz'));
});

void test('invalid timestamps render a marker, never the literal "Invalid Date"', () => {
    const p: FluidityPacket = {
        ...packet,
        ts: 'not-a-timestamp',
        formattedData: [{ suggestStyle: 3, field: 'also-not-a-date', fieldType: 'DATE' }]
    };
    const line = renderLine(p, opts('mono'));
    assert.ok(line.startsWith('[--:--]'), `packet ts guarded: ${line}`);
    assert.ok(line.endsWith('--:--'), 'DATE field guarded too');
    assert.ok(!line.includes('Invalid Date'));
});

void test('golden capture renders at every tier without error; mono stays escape-free', () => {
    const fixturePath = fileURLToPath(
        new URL('../../../sims/fixtures/fy-io-fifo-capture-2026-06-11.json', import.meta.url)
    );
    const capture = JSON.parse(readFileSync(fixturePath, 'utf8')) as FluidityPacket[];
    assert.ok(capture.length >= 250);

    (['truecolor', '256', '16', 'mono'] as const).forEach(tier => {
        capture.forEach(p => {
            const line = renderLine(p, opts(tier));
            assert.ok(line.length > 0);
            if (tier === 'mono') {
                assert.ok(!line.includes('\x1b'), `escape in mono render of seq ${p.seq ?? -1}`);
            }
        });
    });

    //pin one real production packet exactly (16-color)
    const real = capture.find(p => p.rawData === '[40 00 00 00 00]');
    assert.ok(real);
    const line = renderLine(real, opts('16'));
    assert.ok(line.includes('\x1b[96m' + real.site.toUpperCase() + '\x1b[0m'), 'site chrome');
    assert.ok(line.includes('\x1b[97mRadio States: \x1b[0m'), 'heading style 0');
});
