import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paint, styleDef, chromeDef, hexTo256 } from '../modules/theme.js';

void test('paint produces the right SGR per tier', () => {
    const s3 = styleDef(3); //#54b0ed, bold

    assert.equal(paint('x', s3, 'truecolor'), '\x1b[1;38;2;84;176;237mx\x1b[0m');
    assert.equal(paint('x', s3, '256'), `\x1b[1;38;5;${hexTo256('#54b0ed')}mx\x1b[0m`);
    assert.equal(paint('x', s3, '16'), '\x1b[1;94mx\x1b[0m');
    assert.equal(paint('x', s3, 'mono'), 'x');

    const s5 = styleDef(5); //muted mauve, magenta in the 16-color tier (no longer dim)
    assert.equal(paint('x', s5, '16'), '\x1b[35mx\x1b[0m');
});

void test('unknown styles fall back to style 0', () => {
    assert.deepEqual(styleDef(42), styleDef(0));
});

void test('chrome roles match fluidity.css assignments', () => {
    assert.equal(chromeDef('site').hex, '#00fdff'); //--color4
    assert.equal(chromeDef('bracket').hex, '#706c9d'); //--color2
    assert.equal(chromeDef('description').hex, '#999999'); //--color7
    assert.equal(chromeDef('description').bold, true); //web: bolder
});

void test('style 10 (the quiet tone) stays legible on a black background', () => {
    //lightened from #52423d, which sat under 2:1 contrast; parity with
    //fluidity.css --dark, and never dimmed (16-color tiers must read it)
    assert.equal(styleDef(10).hex, '#7d6a5f');
    assert.equal(styleDef(10).dim, undefined);
    assert.equal(paint('x', styleDef(10), '16'), '\x1b[90mx\x1b[0m');
});

void test('hexTo256 quantization', () => {
    assert.equal(hexTo256('#000000'), 16);
    assert.equal(hexTo256('#ffffff'), 231);
    assert.equal(hexTo256('#999999'), 247); //gray ramp beats the cube
    assert.equal(hexTo256('#ff0000'), 196);
});
