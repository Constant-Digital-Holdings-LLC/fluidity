import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateBuckets, livenessOf, FRESH_MS, RECENT_MS } from '#@client/modules/pulse.js';

void test('RateBuckets: counts per bucket, oldest->newest series, gap zeroing', () => {
    const t0 = 1_000_000;
    const rb = new RateBuckets(1000, 5, t0);

    rb.note(t0);
    rb.note(t0 + 100);
    rb.note(t0 + 900); //same bucket: 3
    rb.note(t0 + 1000); //next bucket: 1

    assert.deepEqual(rb.series(t0 + 1000), [0, 0, 0, 3, 1]);

    //two empty buckets pass
    assert.deepEqual(rb.series(t0 + 3000), [0, 3, 1, 0, 0]);

    //a gap larger than the window clears everything
    rb.note(t0 + 60_000);
    assert.deepEqual(rb.series(t0 + 60_000), [0, 0, 0, 0, 1]);
});

void test('RateBuckets: series never changes length and tolerates time standing still', () => {
    const rb = new RateBuckets(5000, 36, 0);
    for (let i = 0; i < 10; i++) rb.note(0);
    assert.equal(rb.series(0).length, 36);
    assert.equal(rb.series(0).at(-1), 10);
});

void test('livenessOf thresholds reflect the 100s heartbeat cadence', () => {
    const now = 10_000_000;
    assert.equal(livenessOf(now, now), 'fresh');
    assert.equal(livenessOf(now - FRESH_MS, now), 'fresh');
    assert.equal(livenessOf(now - FRESH_MS - 1, now), 'recent');
    assert.equal(livenessOf(now - RECENT_MS, now), 'recent');
    assert.equal(livenessOf(now - RECENT_MS - 1, now), 'stale');
});
