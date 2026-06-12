import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paint, styleDef } from '../modules/theme.js';

//The colorbar: the SMPTE-style test pattern for Fluidity's packet palette.
//One reference row of all 11 suggestStyles (0-10). This table is the single
//pinned source of truth - it must stay byte-identical to the web palette in
//client/dist/public/css/fluidity.css (--color0..10/--light/--dark). A drift
//on either side breaks this test, forcing a deliberate, reviewed, in-lockstep
//change (the suggestion contract depends on web/TUI parity).
const BARS: { style: number; hex: string; ansi16: number; bold?: boolean; dim?: boolean }[] = [
    { style: 0, hex: '#ffe5ff', ansi16: 97 }, //light
    { style: 1, hex: '#a66e95', ansi16: 35 }, //muted mauve
    { style: 2, hex: '#706c9d', ansi16: 34 }, //periwinkle
    { style: 3, hex: '#54b0ed', ansi16: 94, bold: true }, //blue (web: bolder)
    { style: 4, hex: '#00fdff', ansi16: 96 }, //cyan
    { style: 5, hex: '#a7628b', ansi16: 35 }, //deeper mauve
    { style: 6, hex: '#fe95c6', ansi16: 95 }, //pink
    { style: 7, hex: '#999999', ansi16: 90 }, //gray
    { style: 8, hex: '#d2b48c', ansi16: 33 }, //tan
    { style: 9, hex: '#ffdab9', ansi16: 93 }, //peachpuff
    { style: 10, hex: '#7d6a5f', ansi16: 90 } //quiet taupe
];

const rgb = (hex: string): [number, number, number] =>
    [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

void test('colorbar: every packet style is pinned at its exact value and attributes', () => {
    assert.equal(BARS.length, 11, 'the palette is styles 0..10');

    for (const bar of BARS) {
        const s = styleDef(bar.style);
        assert.equal(s.hex, bar.hex, `style ${bar.style} truecolor value`);
        assert.equal(s.ansi16, bar.ansi16, `style ${bar.style} 16-color slot`);
        assert.equal(Boolean(s.bold), Boolean(bar.bold), `style ${bar.style} bold`);
        assert.equal(Boolean(s.dim), Boolean(bar.dim), `style ${bar.style} dim`);
    }
});

void test('colorbar: every style renders correctly across all four color tiers', () => {
    for (const bar of BARS) {
        const s = styleDef(bar.style);
        const pre = (bar.bold ? '1;' : '') + (bar.dim ? '2;' : '');
        const [r, g, b] = rgb(bar.hex);

        assert.equal(
            paint('#', s, 'truecolor'),
            `\x1b[${pre}38;2;${r};${g};${b}m#\x1b[0m`,
            `truecolor style ${bar.style}`
        );
        assert.equal(paint('#', s, '16'), `\x1b[${pre}${bar.ansi16}m#\x1b[0m`, `16-color style ${bar.style}`);
        //256 quantizes to the cube/grayscale; it just needs to emit a 38;5;N code
        assert.match(paint('#', s, '256'), /^\x1b\[(1;|2;)*38;5;\d+m#\x1b\[0m$/, `256 style ${bar.style}`);
        //mono strips all color - the readable fallback (pipes, mono terminals)
        assert.equal(paint('#', s, 'mono'), '#', `mono style ${bar.style}`);
    }
});

void test('colorbar: an unknown style falls back to style 0, never throws', () => {
    assert.deepEqual(styleDef(99), styleDef(0));
    assert.equal(paint('x', styleDef(99), 'truecolor'), paint('x', styleDef(0), 'truecolor'));
});
