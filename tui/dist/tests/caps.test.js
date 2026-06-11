import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCaps } from '../modules/caps.js';
void test('capability ladder resolves tiers from environment', () => {
    const cases = [
        [{ COLORTERM: 'truecolor', TERM: 'xterm-256color' }, true, { tier: 'truecolor', hyperlinks: true }],
        [{ WT_SESSION: 'x', TERM: 'xterm-256color' }, true, { tier: 'truecolor', hyperlinks: true }],
        [{ TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' }, true, { tier: 'truecolor', hyperlinks: true }],
        [{ TERM: 'xterm-256color' }, true, { tier: '256', hyperlinks: false }],
        [{ TERM: 'linux' }, true, { tier: '16', hyperlinks: false }],
        [{ TERM: 'xterm' }, true, { tier: '16', hyperlinks: false }],
        [{ TERM: 'dumb' }, true, { tier: 'mono', hyperlinks: false }],
        [{ NO_COLOR: '1', COLORTERM: 'truecolor' }, true, { tier: 'mono', hyperlinks: false }],
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
    assert.deepEqual(detectCaps({ TERM: 'linux' }, true, 'truecolor'), { tier: 'truecolor', hyperlinks: false });
});
//# sourceMappingURL=caps.test.js.map