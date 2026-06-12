import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertRunner, SpawnFn, SpawnedChild, DEFAULT_LIMITS } from '../alertRunner.js';
import { ParsedRule } from '../rules.js';
import { FireEvent } from '../matcher.js';
import { FluidityPacket } from '#@shared/types.js';

//Adversarial: an alert child must receive a MINIMAL env - PATH plus FLU_* only.
//The watcher process inherits the operator's environment, which on a real host
//holds TLS keys, API keys, and other secrets. A regression to `{...process.env}`
//would leak them to every alert program. This pins the guarantee by planting
//secret-looking vars in process.env and asserting none reach the child.

const rule = (over: Partial<ParsedRule> = {}): ParsedRule => ({
    name: 'r',
    selector: { site: 's' },
    trigger: { type: 'frequency', count: 1, windowMs: 1000 },
    recover: false,
    exec: '/bin/true',
    args: [],
    message: '{{site}} {{text}}',
    format: 'text',
    cooldownMs: 0,
    maxPerHour: 1000,
    ...over
});

const packet: FluidityPacket = {
    site: 'site-x',
    plugin: 'p',
    ts: '2026-06-12T00:00:00Z',
    description: 'd',
    formattedData: [{ suggestStyle: 0, field: 'boom', fieldType: 'STRING' }],
    rawData: null
};

const captureEnv = (): { fn: SpawnFn; last: () => Record<string, string> | null } => {
    let captured: Record<string, string> | null = null;
    const fn: SpawnFn = (_cmd, _args, env) => {
        captured = env;
        const child: SpawnedChild = {
            writeStdin() {},
            onExit() {},
            onError() {},
            kill() {}
        };
        return child;
    };
    return { fn, last: () => captured };
};

void test('the alert child env is PATH + FLU_* only - planted secrets never leak', () => {
    const planted = {
        TLS_KEY: 'top-secret-tls-material',
        PERMITTED_KEY: 'the-server-api-key',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        FLUIDITY_SERVER: 'https://internal:3000'
    };
    for (const [k, v] of Object.entries(planted)) process.env[k] = v;
    try {
        const cap = captureEnv();
        const runner = new AlertRunner(DEFAULT_LIMITS, { spawn: cap.fn, now: () => 0 });
        runner.fire({ rule: rule(), reason: 'match', count: 1, packet });

        const env = cap.last();
        assert.ok(env, 'the child was spawned');

        //no planted secret - by key or by value - reached the child
        for (const k of Object.keys(planted)) {
            assert.ok(!(k in env), `secret env ${k} leaked to the alert child`);
        }
        const values = Object.values(env);
        for (const secret of Object.values(planted)) {
            assert.ok(!values.includes(secret), `a secret VALUE (${secret}) leaked to the alert child`);
        }

        //every key the child DID get is either PATH or an FLU_ var - nothing else
        for (const k of Object.keys(env)) {
            assert.ok(k === 'PATH' || k.startsWith('FLU_'), `unexpected env var passed to child: ${k}`);
        }
        assert.equal(env['FLU_SITE'], 'site-x', 'the packet data the child SHOULD get is present');
        assert.ok(env['PATH'], 'PATH is present so the program can find its tools');
    } finally {
        for (const k of Object.keys(planted)) delete process.env[k];
    }
});

void test('FLU_ vars carry packet data only - never a shell-evaluable string', () => {
    //the packet text is hostile; it must arrive verbatim as data, with no
    //interpretation (shell:false is the runner default - here we assert the
    //env value is the raw bytes, not something pre-expanded)
    const cap = captureEnv();
    const runner = new AlertRunner(DEFAULT_LIMITS, { spawn: cap.fn, now: () => 0 });
    const evilPacket: FluidityPacket = {
        ...packet,
        formattedData: [{ suggestStyle: 0, field: '$(touch /tmp/pwned) `id` ${HOME}', fieldType: 'STRING' }]
    };
    const ev: FireEvent = { rule: rule(), reason: 'match', count: 1, packet: evilPacket };
    runner.fire(ev);
    const env = cap.last();
    assert.ok(env);
    assert.equal(env['FLU_TEXT'], '$(touch /tmp/pwned) `id` ${HOME}', 'hostile text is carried verbatim, not expanded');
});
