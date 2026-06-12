import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatternMatcher, FireEvent } from '../matcher.js';
import { parseRules, ParsedRule } from '../rules.js';
import { FluidityPacket } from '#@shared/types.js';

//build rules through the real parser so tests exercise the same shapes
const rules = (raw: unknown[]): ParsedRule[] => parseRules(raw).rules;

const pkt = (site: string, tsMs: number, text = 'x'): FluidityPacket => ({
    site,
    plugin: 'p',
    ts: new Date(tsMs).toISOString(),
    description: 'd',
    formattedData: [{ suggestStyle: 0, field: text, fieldType: 'STRING' }],
    rawData: null
});

const collect = (rs: ParsedRule[]): { m: PatternMatcher; fires: FireEvent[] } => {
    const fires: FireEvent[] = [];
    return { m: new PatternMatcher(rs, e => fires.push(e)), fires };
};

void test('silence fires once after the window, only while connected', () => {
    const { m, fires } = collect(
        rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '120s' }, exec: '/bin/true' }])
    );
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000); //arm last-seen
    m.evaluate(1_060_000); //60s later: not yet silent
    assert.equal(fires.length, 0);
    m.evaluate(1_130_000); //130s later: silent
    assert.equal(fires.length, 1);
    assert.equal(fires[0]?.reason, 'silence');
    assert.equal(fires[0]?.silenceSec, 130);
    m.evaluate(1_200_000); //does not re-fire while still silent
    assert.equal(fires.length, 1);
});

void test('silence does NOT fire while blind (disconnected pipe is not a dead site)', () => {
    const { m, fires } = collect(
        rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '60s' }, exec: '/bin/true' }])
    );
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000);
    m.setConnected(false); //pipe drops
    m.evaluate(1_120_000); //2 min of "silence" but we're blind -> no fire
    assert.equal(fires.length, 0);
});

void test('reconnect reconciles last-seen from /FIFO so a blip does not false-fire', () => {
    const { m, fires } = collect(
        rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '60s' }, exec: '/bin/true' }])
    );
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000);
    m.setConnected(false);
    //...30s blind, but the site kept reporting; the FIFO shows a recent packet
    m.reconcile([pkt('s', 1_025_000)], 1_030_000);
    m.setConnected(true);
    m.evaluate(1_040_000); //only 15s since the reconciled last-seen -> no fire
    assert.equal(fires.length, 0);
    m.evaluate(1_090_000); //now 65s since last-seen -> fire
    assert.equal(fires.length, 1);
});

void test('recover fires when a silenced rule sees a packet again', () => {
    const { m, fires } = collect(
        rules([
            {
                name: 'hb',
                match: { site: 's' },
                trigger: { type: 'silence', window: '60s' },
                exec: '/bin/true',
                recover: true
            }
        ])
    );
    m.setConnected(true);
    m.observe(pkt('s', 1_000_000), 1_000_000);
    m.evaluate(1_070_000); //silence
    assert.equal(fires.at(-1)?.reason, 'silence');
    m.observe(pkt('s', 1_075_000), 1_075_000); //back
    assert.equal(fires.at(-1)?.reason, 'recover');
    assert.equal(fires.length, 2);
});

void test('frequency edge-fires once at the threshold, then re-arms after the window drains', () => {
    const { m, fires } = collect(
        rules([
            {
                name: 'storm',
                match: { site: 's' },
                trigger: { type: 'frequency', count: 3, window: '10s' },
                exec: '/bin/true'
            }
        ])
    );
    let t = 1_000_000;
    m.observe(pkt('s', t), t); // 1
    m.observe(pkt('s', (t += 1000)), t); // 2 - no fire yet
    assert.equal(fires.length, 0);
    m.observe(pkt('s', (t += 1000)), t); // 3 - crosses threshold -> fire once
    assert.equal(fires.length, 1);
    assert.equal(fires[0]?.reason, 'match');
    assert.equal(fires[0]?.count, 3);
    m.observe(pkt('s', (t += 1000)), t); // 4 within window - edge already fired, no re-fire
    assert.equal(fires.length, 1);
    //let the window drain, then a fresh burst fires again
    t += 20_000;
    m.evaluate(t); //prunes old hits, re-arms
    m.observe(pkt('s', t), t);
    m.observe(pkt('s', (t += 100)), t);
    m.observe(pkt('s', (t += 100)), t);
    assert.equal(fires.length, 2);
});

void test('a packet that matches no rule fires nothing', () => {
    const { m, fires } = collect(
        rules([{ name: 'hb', match: { site: 's' }, trigger: { type: 'silence', window: '60s' }, exec: '/bin/true' }])
    );
    m.setConnected(true);
    m.observe(pkt('other', 1_000_000), 1_000_000);
    m.evaluate(1_120_000); //'s' was never seen -> silence not armed, 'other' irrelevant
    assert.equal(fires.length, 0);
});
