import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatternMatcher } from '../matcher.js';
import { AlertRunner } from '../alertRunner.js';
import { parseRules } from '../rules.js';
const capturing = () => {
    const execs = [];
    const fn = (cmd, args) => {
        const rec = { cmd, args, stdin: null };
        execs.push(rec);
        const child = {
            writeStdin: s => {
                rec.stdin = s;
            },
            onExit: () => undefined,
            onError: () => undefined,
            kill: () => undefined
        };
        return child;
    };
    return { fn, execs };
};
const pkt = (over) => ({
    site: 'site',
    plugin: 'logTail',
    description: 'd',
    ts: new Date(over.tsMs).toISOString(),
    formattedData: [{ suggestStyle: 0, field: 'x', fieldType: 'STRING' }],
    rawData: null,
    ...over
});
const wire = (raw, nowRef) => {
    const { fn, execs } = capturing();
    const runner = new AlertRunner(undefined, { spawn: fn, now: () => nowRef.now });
    const matcher = new PatternMatcher(parseRules(raw).rules, e => runner.fire(e));
    return { matcher, runner, execs };
};
void test('a pattern that EXISTS (frequency storm) invokes the hook with the rendered count', () => {
    const t = { now: 1_000_000 };
    const { matcher, execs } = wire([
        {
            name: 'errs',
            match: { plugin: 'logTail', text: 'ERROR' },
            trigger: { type: 'frequency', count: 3, window: '10s' },
            exec: '/opt/notify',
            args: ['--topic', 'ops'],
            message: 'storm: {{count}} on {{site}}'
        }
    ], t);
    matcher.setConnected(true);
    const errLine = (ms) => pkt({
        site: 'gw',
        plugin: 'logTail',
        tsMs: ms,
        formattedData: [{ suggestStyle: 0, field: 'boom ERROR x', fieldType: 'STRING' }]
    });
    matcher.observe(errLine(1_000_000), 1_000_000);
    matcher.observe(errLine(1_001_000), 1_001_000);
    assert.equal(execs.length, 0, 'under the threshold, the hook is not invoked');
    matcher.observe(errLine(1_002_000), 1_002_000);
    assert.equal(execs.length, 1, 'crossing the threshold fires the hook once');
    assert.equal(execs[0]?.cmd, '/opt/notify');
    assert.deepEqual(execs[0]?.args, ['--topic', 'ops']);
    assert.equal(execs[0]?.stdin, 'storm: 3 on gw', 'the rendered message reaches the program on stdin');
    matcher.observe(pkt({ site: 'gw', plugin: 'logTail', tsMs: 1_003_000 }), 1_003_000);
    assert.equal(execs.length, 1, 'a packet that matches no pattern invokes nothing');
});
void test('a pattern that does NOT exist (silence) invokes the hook - but only while connected', () => {
    const t = { now: 1_000_000 };
    const { matcher, runner, execs } = wire([
        {
            name: 'hb',
            match: { site: 'pump' },
            trigger: { type: 'silence', window: '60s' },
            exec: '/opt/notify',
            message: '{{site}} silent {{silenceSec}}s',
            cooldown: 0,
            recover: true
        }
    ], t);
    matcher.setConnected(true);
    matcher.observe(pkt({ site: 'pump', tsMs: 1_000_000 }), 1_000_000);
    t.now = 1_030_000;
    matcher.evaluate(t.now);
    runner.tick();
    assert.equal(execs.length, 0, '30s of quiet is under the 60s window');
    t.now = 1_061_000;
    matcher.evaluate(t.now);
    runner.tick();
    assert.equal(execs.length, 1, 'past the window, the heartbeat hook fires');
    assert.equal(execs[0]?.stdin, 'pump silent 61s');
    matcher.observe(pkt({ site: 'pump', tsMs: 1_065_000 }), 1_065_000);
    assert.equal(execs.length, 2, 'recovery invokes the hook again');
    matcher.setConnected(false);
    t.now = 2_000_000;
    matcher.evaluate(t.now);
    runner.tick();
    assert.equal(execs.length, 2, 'no silence alert while the watcher is blind');
});
