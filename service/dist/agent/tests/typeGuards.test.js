import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isObject, isFluidityLink, isFfluidityPacket } from '#@shared/types.js';
import { counter, isJSONString, isErrnoException } from '#@shared/modules/utils.js';
const validPacket = {
    site: 'site',
    ts: '2026-06-11T00:00:00.000Z',
    description: 'desc',
    plugin: 'genericSerial',
    formattedData: [{ suggestStyle: 0, field: 'x', fieldType: 'STRING' }]
};
void test('isObject', () => {
    assert.equal(isObject({}), true);
    assert.equal(isObject([]), true);
    assert.equal(isObject(null), false);
    assert.equal(isObject('str'), false);
    assert.equal(isObject(undefined), false);
});
void test('isFluidityLink accepts only populated name/location', () => {
    assert.equal(isFluidityLink({ name: 'n', location: 'https://x' }), true);
    assert.equal(isFluidityLink({ name: '', location: 'https://x' }), false);
    assert.equal(isFluidityLink({ name: 'n' }), false);
    assert.equal(isFluidityLink('https://x'), false);
    assert.equal(isFluidityLink(null), false);
});
void test('isFfluidityPacket validates packets', () => {
    assert.equal(isFfluidityPacket(validPacket), true);
    assert.equal(isFfluidityPacket({ ...validPacket, rawData: null }), true);
    assert.equal(isFfluidityPacket({ ...validPacket, rawData: '[01]' }), true);
    assert.equal(isFfluidityPacket(null), false);
    assert.equal(isFfluidityPacket({}), false);
    assert.equal(isFfluidityPacket({ ...validPacket, site: '' }), false);
    assert.equal(isFfluidityPacket({ ...validPacket, plugin: 7 }), false);
    assert.equal(isFfluidityPacket({ ...validPacket, rawData: 42 }), false);
    const { formattedData, ...withoutFormatted } = validPacket;
    void formattedData;
    assert.equal(isFfluidityPacket(withoutFormatted), false);
    assert.equal(isFfluidityPacket(withoutFormatted, true), true);
});
void test('shared utils: counter, isJSONString, isErrnoException', () => {
    const c = counter();
    assert.deepEqual([c.next().value, c.next().value, c.next().value], [1, 2, 3]);
    assert.equal(isJSONString('{"a":1}'), true);
    assert.equal(isJSONString('not json'), false);
    const errno = new Error('boom');
    errno.code = 'ENOENT';
    assert.equal(isErrnoException(errno), true);
    assert.equal(isErrnoException(new Error('plain')), false);
});
