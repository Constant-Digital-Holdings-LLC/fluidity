import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    RateBuckets,
    livenessOf,
    FRESH_MS,
    RECENT_MS,
    PULSE_WINDOWS,
    PULSE_BUCKETS,
    restoreWindowIdx
} from '#@client/modules/pulse.js';
import { HEARTBEAT_SEC } from '#@shared/types.js';

void test('pulse windows: 5m/1h/24h, each fully covered by the bucket count', () => {
    assert.deepEqual(
        PULSE_WINDOWS.map(w => w.label),
        ['5m', '1h', '24h']
    );
    //60 buckets must span the advertised window
    assert.equal(PULSE_WINDOWS[0]!.bucketMs * PULSE_BUCKETS, 5 * 60_000);
    assert.equal(PULSE_WINDOWS[1]!.bucketMs * PULSE_BUCKETS, 60 * 60_000);
    assert.equal(PULSE_WINDOWS[2]!.bucketMs * PULSE_BUCKETS, 24 * 60 * 60_000);
});

void test('restoreWindowIdx: persisted label or safe default', () => {
    assert.equal(restoreWindowIdx('5m'), 0);
    assert.equal(restoreWindowIdx('1h'), 1);
    assert.equal(restoreWindowIdx('24h'), 2);
    assert.equal(restoreWindowIdx('nonsense'), 0);
    assert.equal(restoreWindowIdx(null), 0);
    assert.equal(restoreWindowIdx(undefined), 0);
});

void test('points(): bucket-end timestamps ascend by bucketMs; head may sit in the future', () => {
    const t0 = 1_000_000;
    const rb = new RateBuckets(1000, 4, t0);
    rb.note(t0 + 250);

    const pts = rb.points(t0 + 250);
    assert.equal(pts.length, 4);
    //head bucket [1000000, 1001000) ends at 1001000 - after `now`
    assert.equal(pts.at(-1)?.t, t0 + 1000);
    assert.equal(pts.at(-1)?.v, 1);
    for (let i = 1; i < pts.length; i++) {
        assert.equal(pts[i]!.t - pts[i - 1]!.t, 1000);
    }
});

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

void test('livenessOf thresholds are the boundary edges and derive from the heartbeat', () => {
    const now = 10_000_000;
    assert.equal(livenessOf(now, now), 'fresh');
    assert.equal(livenessOf(now - FRESH_MS, now), 'fresh');
    assert.equal(livenessOf(now - FRESH_MS - 1, now), 'recent');
    assert.equal(livenessOf(now - RECENT_MS, now), 'recent');
    assert.equal(livenessOf(now - RECENT_MS - 1, now), 'stale');
    //windows track the shared HEARTBEAT_SEC (1.5 / 4.5 beats), not magic numbers
    assert.equal(FRESH_MS, HEARTBEAT_SEC * 1500);
    assert.equal(RECENT_MS, HEARTBEAT_SEC * 4500);
});
