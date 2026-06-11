import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCaps } from '../modules/caps.js';

void test('capability ladder resolves tiers from environment', () => {
    const cases: [Record<string, string | undefined>, boolean, ReturnType<typeof detectCaps>][] = [
        //modern emulators
        [{ COLORTERM: 'truecolor', TERM: 'xterm-256color' }, true, { tier: 'truecolor', hyperlinks: true }],
        [{ WT_SESSION: 'x', TERM: 'xterm-256color' }, true, { tier: 'truecolor', hyperlinks: true }],
        [{ TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' }, true, { tier: 'truecolor', hyperlinks: true }],
        //256 without truecolor signal
        [{ TERM: 'xterm-256color' }, true, { tier: '256', hyperlinks: false }],
        //the raspberry pi os text console
        [{ TERM: 'linux' }, true, { tier: '16', hyperlinks: false }],
        //plain/legacy
        [{ TERM: 'xterm' }, true, { tier: '16', hyperlinks: false }],
        [{ TERM: 'dumb' }, true, { tier: 'mono', hyperlinks: false }],
        //NO_COLOR always wins in auto
        [{ NO_COLOR: '1', COLORTERM: 'truecolor' }, true, { tier: 'mono', hyperlinks: false }],
        //pipes are mono unless forced
        [{ COLORTERM: 'truecolor' }, false, { tier: 'mono', hyperlinks: false }],
        [{ COLORTERM: 'truecolor', FORCE_COLOR: '1' }, false, { tier: 'truecolor', hyperlinks: true }]
    ];

    cases.forEach(([env, tty, expected]) => {
        assert.deepEqual(detectCaps(env, tty, 'auto'), expected, JSON.stringify(env));
    });
});

void test('explicit --color mode overrides detection', () => {
    assert.deepEqual(detectCaps({ COLORTERM: 'truecolor' }, true, 'never'), { tier: 'mono', hyperlinks: false });
    assert.deepEqual(detectCaps({ TERM: 'linux' }, true, '256'), { tier: '256', hyperlinks: false });
    assert.deepEqual(detectCaps({ TERM: 'linux' }, false, '16'), { tier: '16', hyperlinks: false });
    //forcing truecolor doesn't force hyperlinks onto a console that can't follow them
    assert.deepEqual(detectCaps({ TERM: 'linux' }, true, 'truecolor'), { tier: 'truecolor', hyperlinks: false });
});
