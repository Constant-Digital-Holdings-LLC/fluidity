import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseRules, matchesSelector, joinedText, SELECTOR_TEXT_CAP } from '../rules.js';
const pkt = (over = {}) => ({
    site: 'greenhouse',
    plugin: 'logTail',
    ts: '2026-06-12T00:00:00.000Z',
    description: 'd',
    formattedData: [{ suggestStyle: 0, field: 'temp 21C ERROR pump', fieldType: 'STRING' }],
    rawData: null,
    ...over
});
void test('parseDuration accepts ms/s/m/h and rejects junk', () => {
    assert.equal(parseDuration('500ms', 'x'), 500);
    assert.equal(parseDuration('120s', 'x'), 120_000);
    assert.equal(parseDuration('10m', 'x'), 600_000);
    assert.equal(parseDuration('2h', 'x'), 7_200_000);
    assert.equal(parseDuration(250, 'x'), 250);
    assert.throws(() => parseDuration('soon', 'x'), /invalid duration/);
    assert.throws(() => parseDuration('10', 'x'), /invalid duration/);
    assert.throws(() => parseDuration({}, 'x'), /duration must be/);
});
void test('matchesSelector: site/plugin equality + text regex (AND)', () => {
    assert.equal(matchesSelector({ site: 'greenhouse' }, pkt()), true);
    assert.equal(matchesSelector({ site: 'other' }, pkt()), false);
    assert.equal(matchesSelector({ plugin: 'logTail' }, pkt()), true);
    assert.equal(matchesSelector({ text: /ERROR/ }, pkt()), true);
    assert.equal(matchesSelector({ text: /NOPE/ }, pkt()), false);
    assert.equal(matchesSelector({ site: 'greenhouse', text: /ERROR/ }, pkt()), true);
    assert.equal(matchesSelector({ site: 'greenhouse', text: /NOPE/ }, pkt()), false);
});
void test('joinedText caps length (ReDoS bound) and includes link parts', () => {
    const long = pkt({ formattedData: [{ suggestStyle: 0, field: 'x'.repeat(9999), fieldType: 'STRING' }] });
    assert.equal(joinedText(long).length, SELECTOR_TEXT_CAP);
    const link = pkt({
        formattedData: [{ suggestStyle: 6, field: { name: 'docs', location: 'https://x/y' }, fieldType: 'LINK' }]
    });
    assert.match(joinedText(link), /docs https:\/\/x\/y/);
});
void test('parseRules: a valid silence + frequency config', () => {
    const { rules, skipped } = parseRules([
        {
            name: 'hb',
            match: { site: 'greenhouse' },
            trigger: { type: 'silence', window: '120s' },
            exec: '/bin/true',
            message: '{{site}} down',
            cooldown: '5m',
            recover: true
        },
        {
            name: 'storm',
            match: { plugin: 'logTail', text: 'ERROR' },
            trigger: { type: 'frequency', count: 10, window: '60s' },
            exec: '/bin/true'
        }
    ]);
    assert.equal(skipped.length, 0);
    assert.equal(rules.length, 2);
    assert.deepEqual(rules[0]?.trigger, { type: 'silence', windowMs: 120_000 });
    assert.equal(rules[0]?.recover, true);
    assert.equal(rules[0]?.cooldownMs, 300_000);
    assert.deepEqual(rules[1]?.trigger, { type: 'frequency', count: 10, windowMs: 60_000 });
    assert.ok(rules[1]?.selector.text instanceof RegExp);
});
void test('parseRules: enabled:false is skipped, not loaded', () => {
    const { rules, skipped } = parseRules([
        {
            name: 'off',
            enabled: false,
            match: { site: 's' },
            trigger: { type: 'silence', window: '1m' },
            exec: '/bin/true'
        },
        { name: 'on', match: { site: 's' }, trigger: { type: 'silence', window: '1m' }, exec: '/bin/true' }
    ]);
    assert.deepEqual(skipped, ['off']);
    assert.deepEqual(rules.map(r => r.name), ['on']);
});
void test('parseRules: checkExec is invoked per enabled rule', () => {
    const checked = [];
    parseRules([{ name: 'a', match: { site: 's' }, trigger: { type: 'silence', window: '1m' }, exec: '/usr/bin/foo' }], {
        checkExec: p => checked.push(p)
    });
    assert.deepEqual(checked, ['/usr/bin/foo']);
    assert.throws(() => parseRules([{ name: 'a', match: { site: 's' }, trigger: { type: 'silence', window: '1m' }, exec: '/no' }], {
        checkExec: () => {
            throw new Error('not executable');
        }
    }), /not executable/);
});
void test('parseRules: misconfiguration throws at parse time', () => {
    const base = { name: 'a', match: { site: 's' }, trigger: { type: 'silence', window: '1m' }, exec: '/bin/true' };
    assert.throws(() => parseRules('nope'), /must be an array/);
    assert.throws(() => parseRules([{ ...base, name: '' }]), /name must be/);
    assert.throws(() => parseRules([{ ...base, match: {} }]), /at least one of site\/plugin\/text/);
    assert.throws(() => parseRules([{ ...base, match: { text: '(' } }]), /not a valid regex/);
    assert.throws(() => parseRules([{ ...base, match: { text: '(a+)+' } }]), /nested unbounded quantifier/);
    assert.throws(() => parseRules([{ ...base, trigger: { type: 'nope' } }]), /must be "silence" or "frequency"/);
    assert.throws(() => parseRules([{ ...base, trigger: { type: 'frequency', count: 0, window: '1m' } }]), /count must be an integer/);
    assert.throws(() => parseRules([{ ...base, exec: '' }]), /exec must be/);
    assert.throws(() => parseRules([{ ...base, format: 'xml' }]), /format must be/);
    assert.throws(() => parseRules([{ ...base, maxPerHour: 0 }]), /maxPerHour must be/);
    assert.throws(() => parseRules([base, { ...base }]), /duplicate rule name/);
});
