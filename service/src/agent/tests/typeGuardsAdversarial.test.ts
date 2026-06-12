import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFfluidityPacket, isFluidityLink } from '#@shared/types.js';

//Adversarial: isFfluidityPacket is the contract the server leans on to "never
//relay a malformed packet". These attack the guard with shapes a hostile or
//buggy producer could send - arrays posing as objects, prototype-pollution
//payloads, dangerous link schemes - and pin the security-relevant rejections.
//(Plain malformed-field cases live in typeGuards.test.ts; this file targets the
//attacks, not the routine rejections.)

const valid = {
    site: 's',
    ts: '2026-06-11T00:00:00.000Z',
    description: 'd',
    plugin: 'p',
    formattedData: [{ suggestStyle: 0, field: 'x', fieldType: 'STRING' }]
};

void test('an array is never accepted as a packet (array is typeof object)', () => {
    //isObject treats arrays as objects; the guard must still reject them because
    //they have no string site/plugin/description
    assert.equal(isFfluidityPacket([]), false);
    assert.equal(isFfluidityPacket([valid]), false);
    assert.equal(isFfluidityPacket([valid] as unknown), false);
});

void test('a prototype-pollution payload neither validates falsely nor pollutes Object.prototype', () => {
    //JSON.parse creates a real own "__proto__"/"constructor" key; the guard reads
    //only named fields, so it must not be tricked and must not pollute globals
    const pollutionOnly = JSON.parse('{"__proto__":{"polluted":7},"constructor":{"x":1}}') as unknown;
    assert.equal(isFfluidityPacket(pollutionOnly), false, 'a pollution-only object is not a packet');

    const realButPolluted = JSON.parse(
        '{"site":"s","ts":"2026-06-11T00:00:00.000Z","description":"d","plugin":"p","formattedData":[{"suggestStyle":0,"field":"x","fieldType":"STRING"}],"__proto__":{"polluted":7}}'
    ) as unknown;
    assert.equal(
        isFfluidityPacket(realButPolluted),
        true,
        'a valid packet that happens to carry __proto__ still validates on its real fields'
    );

    //the critical assertion: running the guard left Object.prototype clean
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined, 'Object.prototype was not polluted');
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
        'HTTPS:/x', //malformed - single slash
        '//x/y' //scheme-relative, no scheme
    ]) {
        assert.equal(isFluidityLink({ name: 'n', location }), false, `${location} must be rejected`);
        assert.equal(
            isFfluidityPacket({
                ...valid,
                formattedData: [{ suggestStyle: 0, fieldType: 'LINK', field: { name: 'n', location } }]
            }),
            false,
            `a packet bearing a ${location} link must be rejected whole`
        );
    }
});

void test('nonsense timestamps are rejected (no Invalid-Date packets reach the FIFO)', () => {
    for (const ts of ['not-a-date', '2026-13-45T00:00:00Z', '', 'NaN', 'yesterday']) {
        assert.equal(isFfluidityPacket({ ...valid, ts }), false, `ts ${JSON.stringify(ts)} must be rejected`);
    }
});
