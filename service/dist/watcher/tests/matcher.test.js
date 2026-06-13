import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatternMatcher } from '../matcher.js';
import { parseRules } from '../rules.js';
const rules = (raw) => parseRules(raw).rules;
const pkt = (site, tsMs, text = 'x') => ({
    site,
    plugin: 'p',
    ts: new Date(tsMs).toISOString(),
    description: 'd',
    formattedData: [{ suggestStyle: 0, field: text, fieldType: 'STRING' }],
    rawData: null
});
const collect = (rs) => {
    const fires = [];
    return { m: new PatternMatcher(rs, e => fires.push(e)), fires };
};
void test('silence fires once after the window, only while connected', () => {
    const { m, fires } = collect(rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '120s' }, exec: '/bin/true' }]));
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000);
    m.evaluate(1_060_000);
    assert.equal(fires.length, 0);
    m.evaluate(1_130_000);
    assert.equal(fires.length, 1);
    assert.equal(fires[0]?.reason, 'silence');
    assert.equal(fires[0]?.silenceSec, 130);
    m.evaluate(1_200_000);
    assert.equal(fires.length, 1);
});
void test('silence does NOT fire while blind (disconnected pipe is not a dead site)', () => {
    const { m, fires } = collect(rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '60s' }, exec: '/bin/true' }]));
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000);
    m.setConnected(false);
    m.evaluate(1_120_000);
    assert.equal(fires.length, 0);
});
void test('reconnect reconciles last-seen from /FIFO so a blip does not false-fire', () => {
    const { m, fires } = collect(rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '60s' }, exec: '/bin/true' }]));
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000);
    m.setConnected(false);
    m.reconcile([pkt('s', 1_025_000)], 1_030_000);
    m.setConnected(true);
    m.evaluate(1_040_000);
    assert.equal(fires.length, 0);
    m.evaluate(1_090_000);
    assert.equal(fires.length, 1);
});
void test('recover fires when a silenced rule sees a packet again', () => {
    const { m, fires } = collect(rules([
        {
            name: 'hb',
            match: { site: 's' },
            trigger: { type: 'silence', window: '60s' },
            exec: '/bin/true',
            recover: true
        }
    ]));
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000);
    m.evaluate(1_070_000);
    assert.equal(fires.at(-1)?.reason, 'silence');
    m.observe(pkt('s', 1_075_000), 1_075_000);
    assert.equal(fires.at(-1)?.reason, 'recover');
    assert.equal(fires.length, 2);
});
void test('frequency edge-fires once at the threshold, then re-arms after the window drains', () => {
    const { m, fires } = collect(rules([
        {
            name: 'storm',
            match: { site: 's' },
            trigger: { type: 'frequency', count: 3, window: '10s' },
            exec: '/bin/true'
        }
    ]));
    let t = 1_000_000;
    m.observe(pkt('s', t), t);
    m.observe(pkt('s', (t += 1000)), t);
    assert.equal(fires.length, 0);
    m.observe(pkt('s', (t += 1000)), t);
    assert.equal(fires.length, 1);
    assert.equal(fires[0]?.reason, 'match');
    assert.equal(fires[0]?.count, 3);
    m.observe(pkt('s', (t += 1000)), t);
    assert.equal(fires.length, 1);
    t += 20_000;
    m.evaluate(t);
    m.observe(pkt('s', t), t);
    m.observe(pkt('s', (t += 100)), t);
    m.observe(pkt('s', (t += 100)), t);
    assert.equal(fires.length, 2);
});
void test('match fires on every matching packet, even a sustained stream', () => {
    const { m, fires } = collect(rules([
        { name: 'route', match: { site: 's', text: '\\[P5\\]' }, trigger: { type: 'match' }, exec: '/bin/true' }
    ]));
    m.setConnected(true);
    let t = 1_000_000;
    m.observe(pkt('s', t, '[P5] disk failing'), t);
    m.observe(pkt('s', (t += 200), '[P5] array degraded'), t);
    m.observe(pkt('s', (t += 200), '[P5] sensor critical'), t);
    assert.equal(fires.length, 3);
    assert.ok(fires.every(f => f.reason === 'match' && f.count === 1 && f.packet !== undefined));
    m.observe(pkt('other', (t += 200), '[P5] x'), t);
    m.observe(pkt('s', (t += 200), '[P3] info'), t);
    assert.equal(fires.length, 3);
    m.evaluate(t + 60_000);
    assert.equal(fires.length, 3);
});
void test('a packet that matches no rule fires nothing', () => {
    const { m, fires } = collect(rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '60s' }, exec: '/bin/true' }]));
    m.setConnected(true);
    m.observe(pkt('other', 1_000_000), 1_000_000);
    m.evaluate(1_120_000);
    assert.equal(fires.length, 0);
});
