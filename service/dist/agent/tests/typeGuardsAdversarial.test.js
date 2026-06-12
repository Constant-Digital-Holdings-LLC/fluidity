import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFfluidityPacket, isFluidityLink } from '#@shared/types.js';
const valid = {
    site: 's',
    ts: '2026-06-11T00:00:00.000Z',
    description: 'd',
    plugin: 'p',
    formattedData: [{ suggestStyle: 0, field: 'x', fieldType: 'STRING' }]
};
void test('an array is never accepted as a packet (array is typeof object)', () => {
    assert.equal(isFfluidityPacket([]), false);
    assert.equal(isFfluidityPacket([valid]), false);
    assert.equal(isFfluidityPacket([valid]), false);
});
void test('a prototype-pollution payload neither validates falsely nor pollutes Object.prototype', () => {
    const pollutionOnly = JSON.parse('{"__proto__":{"polluted":7},"constructor":{"x":1}}');
    assert.equal(isFfluidityPacket(pollutionOnly), false, 'a pollution-only object is not a packet');
    const realButPolluted = JSON.parse('{"site":"s","ts":"2026-06-11T00:00:00.000Z","description":"d","plugin":"p","formattedData":[{"suggestStyle":0,"field":"x","fieldType":"STRING"}],"__proto__":{"polluted":7}}');
    assert.equal(isFfluidityPacket(realButPolluted), true, 'a valid packet that happens to carry __proto__ still validates on its real fields');
    assert.equal({}['polluted'], undefined, 'Object.prototype was not polluted');
});
void test('only http/https link locations pass; script/data/file schemes are rejected', () => {
    for (const location of ['https://x/y', 'http://x/y']) {
        assert.equal(isFluidityLink({ name: 'n', location }), true, `${location} should pass`);
    }
    for (const location of [
        'javascript:alert(1)',
        'data:text/html,<script>1</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'HTTPS:/x',
        '//x/y'
    ]) {
        assert.equal(isFluidityLink({ name: 'n', location }), false, `${location} must be rejected`);
        assert.equal(isFfluidityPacket({
            ...valid,
            formattedData: [{ suggestStyle: 0, fieldType: 'LINK', field: { name: 'n', location } }]
        }), false, `a packet bearing a ${location} link must be rejected whole`);
    }
});
void test('nonsense timestamps are rejected (no Invalid-Date packets reach the FIFO)', () => {
    for (const ts of ['not-a-date', '2026-13-45T00:00:00Z', '', 'NaN', 'yesterday']) {
        assert.equal(isFfluidityPacket({ ...valid, ts }), false, `ts ${JSON.stringify(ts)} must be rejected`);
    }
});
