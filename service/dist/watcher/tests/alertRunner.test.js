import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertRunner, DEFAULT_LIMITS } from '../alertRunner.js';
const rule = (over = {}) => ({
    name: 'r',
    selector: { site: 's' },
    trigger: { type: 'frequency', count: 1, windowMs: 1000 },
    recover: false,
    exec: '/bin/true',
    args: [],
    message: '{{rule}} {{count}}',
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
class FakeSpawner {
    calls = [];
    fn = (cmd, args, env) => {
        let exitCb = () => undefined;
        let errCb = () => undefined;
        const child = {
            stdinText: null,
            kills: [],
            writeStdin(s) {
                child.stdinText = s;
            },
            onExit(cb) {
                exitCb = cb;
            },
            onError(cb) {
                errCb = cb;
            },
            kill(sig) {
                child.kills.push(sig);
            },
            fireExit(c) {
                exitCb(c);
            },
            fireError(e) {
                errCb(e);
            }
        };
        this.calls.push({ cmd, args, env, child });
        return child;
    };
}
const limits = (over = {}) => ({ ...DEFAULT_LIMITS, ...over });
void test('a single fire spawns the program with the right argv/env/stdin', () => {
    const sp = new FakeSpawner();
    const now = 1000;
    const r = new AlertRunner(limits(), { spawn: sp.fn, now: () => now });
    const packet = {
        site: 's1',
        plugin: 'logTail',
        ts: '2026-06-12T00:00:00Z',
        description: 'd',
        formattedData: [{ suggestStyle: 0, field: 'boom', fieldType: 'STRING' }],
        rawData: null
    };
    r.fire(ev(rule({ exec: '/opt/alert', args: ['--topic', 'x'], message: '{{site}}: {{text}}' }), { packet }));
    assert.equal(sp.calls.length, 1);
    const c = sp.calls[0];
    assert.equal(c.cmd, '/opt/alert');
    assert.deepEqual(c.args, ['--topic', 'x']);
    assert.equal(c.child.stdinText, 's1: boom');
    assert.equal(c.env['FLU_SITE'], 's1');
    assert.equal(c.env['FLU_TEXT'], 'boom');
    assert.equal(c.env['FLU_REASON'], 'match');
    assert.ok(!('FLU_SECRET' in c.env) && c.env['PATH'], 'clean env: PATH present, no inherited secrets');
});
void test('cooldown coalesces; the post-cooldown tick flushes a summary with the count', () => {
    const sp = new FakeSpawner();
    let now = 0;
    const r = new AlertRunner(limits(), { spawn: sp.fn, now: () => now });
    const ru = rule({ cooldownMs: 10_000, message: '{{count}}' });
    r.fire(ev(ru));
    r.fire(ev(ru));
    r.fire(ev(ru));
    assert.equal(sp.calls.length, 1);
    assert.equal(sp.calls[0].child.stdinText, '1');
    assert.equal(r.stats.coalesced, 2);
    now = 11_000;
    r.tick();
    assert.equal(sp.calls.length, 2);
    assert.equal(sp.calls[1].child.stdinText, '2', 'summary carries the coalesced count');
});
void test('concurrency cap holds; a slot frees only when a child exits', () => {
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 2, queueCap: 64 }), { spawn: sp.fn, now: () => 0 });
    const ru = rule({ cooldownMs: 0 });
    for (let i = 0; i < 5; i++)
        r.fire(ev(ru));
    assert.equal(sp.calls.length, 2, 'never more than maxConcurrent children at once');
    sp.calls[0].child.fireExit(0);
    assert.equal(sp.calls.length, 3, 'queued job runs when a slot frees');
});
void test('queue shed beyond the cap is bounded and counted', () => {
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 1, queueCap: 2 }), { spawn: sp.fn, now: () => 0 });
    const ru = rule({ cooldownMs: 0 });
    for (let i = 0; i < 5; i++)
        r.fire(ev(ru));
    assert.equal(sp.calls.length, 1);
    assert.equal(r.stats.queueShed, 2);
});
void test('per-rule token bucket caps the firing rate', () => {
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ maxConcurrent: 10 }), { spawn: sp.fn, now: () => 5000 });
    const ru = rule({ cooldownMs: 0, maxPerHour: 2 });
    for (let i = 0; i < 5; i++)
        r.fire(ev(ru));
    assert.equal(sp.calls.length, 2, 'only maxPerHour tokens available');
    assert.equal(r.stats.rateShed, 3);
});
void test('circuit breaker parks a rule after repeated failures', () => {
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ failureThreshold: 3, circuitMs: 60_000, maxConcurrent: 10 }), {
        spawn: sp.fn,
        now: () => 0
    });
    const ru = rule({ cooldownMs: 0 });
    for (let i = 0; i < 3; i++) {
        r.fire(ev(ru));
        sp.calls[i].child.fireExit(1);
    }
    assert.equal(r.stats.failed, 3);
    const before = sp.calls.length;
    r.fire(ev(ru));
    assert.equal(sp.calls.length, before);
    assert.equal(r.stats.circuitShed, 1);
});
void test('a child past the timeout is killed', async () => {
    const sp = new FakeSpawner();
    const r = new AlertRunner(limits({ execTimeoutMs: 20 }), { spawn: sp.fn, now: () => 0 });
    r.fire(ev(rule()));
    const child = sp.calls[0].child;
    await sleep(60);
    assert.ok(child.kills.includes('SIGTERM'), 'timed-out child is signalled');
    child.fireExit(null);
    assert.equal(r.stats.killed, 1);
    r.stop();
});
void test('dryRun logs what would fire and never spawns', () => {
    const sp = new FakeSpawner();
    const logs = [];
    const r = new AlertRunner(limits(), { spawn: sp.fn, now: () => 0, dryRun: true, log: (_l, m) => logs.push(m) });
    r.fire(ev(rule({ exec: '/opt/alert', args: ['--topic', 'x'], message: 'hi' })));
    assert.equal(sp.calls.length, 0, 'nothing is spawned in dryRun');
    assert.equal(r.stats.fired, 1);
    assert.equal(r.stats.completed, 1);
    assert.match(logs.join('\n'), /\[dryRun\] would exec \/opt\/alert --topic x :: hi/);
});
void test('injection-safe: untrusted packet text reaches a real child as inert data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flu-alert-'));
    try {
        const out = join(dir, 'out.txt');
        const pwned = join(dir, 'PWNED');
        const script = join(dir, 'alert.sh');
        writeFileSync(script, `#!/bin/sh\n{ printf 'STDIN:%s\\n' "$(cat)"; printf 'SITE:%s\\nTEXT:%s\\n' "$FLU_SITE" "$FLU_TEXT"; } > "$1"\n`);
        chmodSync(script, 0o755);
        const r = new AlertRunner(limits());
        const evil = `$(touch ${pwned}); rm -rf /tmp/nope`;
        const packet = {
            site: 'site-x',
            plugin: 'p',
            ts: '2026-06-12T00:00:00Z',
            description: 'd',
            formattedData: [{ suggestStyle: 0, field: evil, fieldType: 'STRING' }],
            rawData: null
        };
        r.fire(ev(rule({ exec: script, args: [out], message: 'hi {{site}}' }), { packet }));
        const read = () => (existsSync(out) ? readFileSync(out, 'utf8') : '');
        for (let i = 0; i < 100 && !read().includes('STDIN:'); i++)
            await sleep(20);
        const body = read();
        assert.ok(body.length > 0, 'the alert program ran');
        assert.match(body, /STDIN:hi site-x/, 'stdin delivered the rendered message');
        assert.match(body, /SITE:site-x/, 'env carried the packet site');
        assert.ok(body.includes(evil), 'the dangerous text is present verbatim as data');
        assert.ok(!existsSync(pwned), 'command substitution in the data was NEVER executed');
        r.stop();
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
