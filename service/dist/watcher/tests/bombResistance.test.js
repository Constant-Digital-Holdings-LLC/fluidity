import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertRunner, DEFAULT_LIMITS } from '../alertRunner.js';
const rule = (over = {}) => ({
    name: 'r',
    selector: { site: 's' },
    trigger: { type: 'frequency', count: 1, windowMs: 1000 },
    recover: false,
    exec: '/bin/true',
    args: [],
    message: '{{count}}',
    format: 'text',
    cooldownMs: 0,
    maxPerHour: 1000,
    ...over
});
const ev = (r, over = {}) => ({
    rule: r,
    reason: 'match',
    count: 1,
    ...over
});
const limits = (over = {}) => ({ ...DEFAULT_LIMITS, ...over });
class FakeSpawner {
    total = 0;
    live = 0;
    maxLive = 0;
    lastStdin = null;
    pending = [];
    fn = () => {
        this.total++;
        this.live++;
        if (this.live > this.maxLive)
            this.maxLive = this.live;
        let onExit = () => undefined;
        const child = {
            writeStdin: s => {
                this.lastStdin = s;
            },
            onExit: cb => {
                onExit = cb;
            },
            onError: () => undefined,
            kill: () => undefined
        };
        this.pending.push(c => onExit(c));
        return child;
    };
    exitOne(code = 0) {
        const e = this.pending.shift();
        if (e) {
            this.live--;
            e(code);
        }
    }
    drain(code = 0) {
        while (this.pending.length)
            this.exitOne(code);
    }
}
void test('fork-bomb: concurrent children never exceed maxConcurrent, even with churn', () => {
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 3, queueCap: 1000 }), { spawn: sp.fn, now: () => 0 });
    const ru = rule({ cooldownMs: 0, maxPerHour: 1_000_000 });
    for (let i = 0; i < 50; i++)
        r.fire(ev(ru));
    sp.drain(0);
    for (let i = 0; i < 50; i++)
        r.fire(ev(ru));
    sp.drain(0);
    assert.ok(sp.maxLive <= 3, `peak concurrency ${sp.maxLive} must not exceed maxConcurrent 3`);
    assert.equal(sp.total, 100, 'all queued work eventually ran (nothing lost), just never >3 at once');
    assert.equal(r.stats.queueShed, 0, 'queueCap 1000 was ample, so nothing was shed');
});
void test('message-bomb: a 3000-match storm reaches the recipient as <= ~maxPerHour messages/hour', () => {
    let now = 0;
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 100, queueCap: 5000 }), { spawn: sp.fn, now: () => now });
    const ru = rule({ cooldownMs: 0, maxPerHour: 12 });
    for (const at of [0, 1_800_000, 3_600_000]) {
        now = at;
        for (let k = 0; k < 1000; k++)
            r.fire(ev(ru));
        sp.drain(0);
    }
    assert.ok(sp.total <= 24, `recipient shielded: ${sp.total} messages delivered for 3000 matches`);
    assert.ok(sp.total >= 12, 'but real alerts still get through (not zero)');
    assert.ok(r.stats.rateShed > 2900, `the storm was shed by the token bucket (${r.stats.rateShed} shed)`);
});
void test('message-bomb: cooldown coalesces a burst into ONE follow-up carrying the true count', () => {
    let now = 0;
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 100 }), { spawn: sp.fn, now: () => now });
    const ru = rule({ cooldownMs: 60_000, maxPerHour: 1_000_000, message: '{{count}}' });
    for (let k = 0; k < 1000; k++)
        r.fire(ev(ru));
    assert.equal(sp.total, 1, 'only the first match fires immediately');
    assert.equal(r.stats.coalesced, 999);
    now = 61_000;
    r.tick();
    assert.equal(sp.total, 2, '1000 matches -> exactly 2 messages to the recipient');
    assert.equal(sp.lastStdin, '999', 'the follow-up carries the coalesced count, not a per-match flood');
});
void test('message-bomb: a tripped circuit re-closes after circuitMs (no permanent silence)', () => {
    let now = 0;
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ failureThreshold: 3, circuitMs: 60_000, maxConcurrent: 100 }), {
        spawn: sp.fn,
        now: () => now
    });
    const ru = rule({ cooldownMs: 0, maxPerHour: 1_000_000 });
    for (let i = 0; i < 3; i++) {
        r.fire(ev(ru));
        sp.exitOne(1);
    }
    const afterTrip = sp.total;
    r.fire(ev(ru));
    assert.equal(sp.total, afterTrip, "while the circuit is open, nothing is exec'd");
    assert.ok(r.stats.circuitShed >= 1);
    now = 61_000;
    r.fire(ev(ru));
    assert.equal(sp.total, afterTrip + 1, 'the circuit re-closed: alerts flow again');
});
