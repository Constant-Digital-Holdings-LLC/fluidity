import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downsample, stripOf } from '../modules/rateStrip.js';

void test('downsample: max-pooling preserves spikes', () => {
    assert.deepEqual(downsample([1, 9, 0, 0, 2, 3], 3), [9, 0, 3]);
    assert.deepEqual(downsample([1, 2], 4), [1, 2]); //fewer points than cells: as-is
    assert.deepEqual(downsample([5, 5, 5], 0), []);
    assert.equal(downsample(new Array(60).fill(1), 24).length, 24);
});

void test('stripOf: silence is space, peak is full block, levels in between', () => {
    const strip = stripOf([0, 1, 2, 4], 4);
    assert.equal(strip.length, 4);
    assert.equal(strip[0], ' ');
    assert.equal(strip[3], '█');
    assert.ok(['░', '▒', '▓'].includes(strip[1] ?? ''));

    //all-zero series renders as pure silence
    assert.equal(stripOf([0, 0, 0], 3), '   ');
    //CP437-safe: only the shade ramp and space, ever
    for (const ch of stripOf([3, 0, 7, 1, 9, 2], 6)) {
        assert.ok([' ', '░', '▒', '▓', '█'].includes(ch), `unexpected char: ${ch}`);
    }
});
