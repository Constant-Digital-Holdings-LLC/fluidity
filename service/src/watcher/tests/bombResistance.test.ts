import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertRunner, SpawnFn, SpawnedChild, RunnerLimits, DEFAULT_LIMITS } from '../alertRunner.js';
import { FireEvent } from '../matcher.js';
import { ParsedRule } from '../rules.js';

//These are SYSTEM-property tests for the two abuse vectors, complementing the
//per-guard unit tests in alertRunner.test.ts:
//  - fork bomb (too many child processes): a flood must never exceed the
//    concurrency cap, even as slots free and the queue drains.
//  - message bomb (spamming the ultimate recipient, e.g. ntfy): a relentless
//    storm must reach the recipient as a SMALL bounded number of messages, via
//    cooldown-coalescing and the per-rule token bucket - and the circuit must
//    re-close on its own so a transient failure doesn't park a rule forever.

const rule = (over: Partial<ParsedRule> = {}): ParsedRule => ({
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
const ev = (r: ParsedRule, over: Partial<FireEvent> = {}): FireEvent => ({
    rule: r,
    reason: 'match',
    count: 1,
    ...over
});
const limits = (over: Partial<RunnerLimits> = {}): RunnerLimits => ({ ...DEFAULT_LIMITS, ...over });

//a spawner that tracks live/peak concurrency and lets the test exit children
class FakeSpawner {
    total = 0;
    live = 0;
    maxLive = 0;
    lastStdin: string | null = null;
    private readonly pending: Array<(c: number | null) => void> = [];
    fn: SpawnFn = () => {
        this.total++;
        this.live++;
        if (this.live > this.maxLive) this.maxLive = this.live;
        let onExit: (c: number | null) => void = () => undefined;
        const child: SpawnedChild = {
            writeStdin: s => {
                this.lastStdin = s;
            },
            onExit: cb => {
                onExit = cb;
            },
            onError: () => undefined,
            kill: () => undefined
        };
        this.pending.push(c => onExit(c)); //reads the runner's real cb at call time
        return child;
    };
    exitOne(code: number | null = 0): void {
        const e = this.pending.shift();
        if (e) {
            this.live--;
            e(code); //may pump the queue -> spawn another -> live++
        }
    }
    drain(code: number | null = 0): void {
        while (this.pending.length) this.exitOne(code);
    }
}

void test('fork-bomb: concurrent children never exceed maxConcurrent, even with churn', () => {
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 3, queueCap: 1000 }), { spawn: sp.fn, now: () => 0 });
    const ru = rule({ cooldownMs: 0, maxPerHour: 1_000_000 });

    for (let i = 0; i < 50; i++) r.fire(ev(ru)); //3 run, 47 queue
    sp.drain(0); //exit each -> pump pulls a queued job; peak must hold at 3
    for (let i = 0; i < 50; i++) r.fire(ev(ru)); //a second wave
    sp.drain(0);

    assert.ok(sp.maxLive <= 3, `peak concurrency ${sp.maxLive} must not exceed maxConcurrent 3`);
    assert.equal(sp.total, 100, 'all queued work eventually ran (nothing lost), just never >3 at once');
    assert.equal(r.stats.queueShed, 0, 'queueCap 1000 was ample, so nothing was shed');
});

void test('message-bomb: a 3000-match storm reaches the recipient as <= ~maxPerHour messages/hour', () => {
    let now = 0;
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 100, queueCap: 5000 }), { spawn: sp.fn, now: () => now });
    const ru = rule({ cooldownMs: 0, maxPerHour: 12 }); //token bucket only

    for (const at of [0, 1_800_000, 3_600_000]) {
        //relentless: 1000 matches at the start, the half-hour, and the hour
        now = at;
        for (let k = 0; k < 1000; k++) r.fire(ev(ru));
        sp.drain(0);
    }
    //12 from the initial bucket + ~6 per half-hour of refill = 24, NOT 3000
    assert.ok(sp.total <= 24, `recipient shielded: ${sp.total} messages delivered for 3000 matches`);
    assert.ok(sp.total >= 12, 'but real alerts still get through (not zero)');
    assert.ok(r.stats.rateShed > 2900, `the storm was shed by the token bucket (${r.stats.rateShed} shed)`);
});

void test('message-bomb: cooldown coalesces a burst into ONE follow-up carrying the true count', () => {
    let now = 0;
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 100 }), { spawn: sp.fn, now: () => now });
    const ru = rule({ cooldownMs: 60_000, maxPerHour: 1_000_000, message: '{{count}}' });

    for (let k = 0; k < 1000; k++) r.fire(ev(ru)); //1 fires, 999 coalesce
    assert.equal(sp.total, 1, 'only the first match fires immediately');
    assert.equal(r.stats.coalesced, 999);

    now = 61_000; //cooldown elapsed
    r.tick();
    assert.equal(sp.total, 2, '1000 matches -> exactly 2 messages to the recipient');
    //1 fired immediately (count 1), the other 999 coalesced into this follow-up
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
        sp.exitOne(1); //non-zero exit = failure; the 3rd opens the circuit
    }
    const afterTrip = sp.total;
    r.fire(ev(ru)); //circuit open -> shed, no spawn
    assert.equal(sp.total, afterTrip, "while the circuit is open, nothing is exec'd");
    assert.ok(r.stats.circuitShed >= 1);

    now = 61_000; //circuitMs elapsed
    r.fire(ev(ru));
    assert.equal(sp.total, afterTrip + 1, 'the circuit re-closed: alerts flow again');
});
