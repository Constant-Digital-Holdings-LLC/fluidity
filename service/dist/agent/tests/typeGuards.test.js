import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isObject, isFluidityLink, isFfluidityPacket, isFormattedData, stripControlChars } from '#@shared/types.js';
import { counter, isErrnoException } from '#@shared/modules/utils.js';
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
void test('isFluidityLink requires populated name and an http(s), control-free location', () => {
    assert.equal(isFluidityLink({ name: 'n', location: 'https://x' }), true);
    assert.equal(isFluidityLink({ name: 'n', location: 'http://x/path?q=1' }), true);
    assert.equal(isFluidityLink({ name: '', location: 'https://x' }), false);
    assert.equal(isFluidityLink({ name: 'n' }), false);
    assert.equal(isFluidityLink('https://x'), false);
    assert.equal(isFluidityLink(null), false);
    assert.equal(isFluidityLink({ name: 'n', location: 'javascript:alert(1)' }), false);
    assert.equal(isFluidityLink({ name: 'n', location: 'data:text/html,hi' }), false);
    assert.equal(isFluidityLink({ name: 'n', location: 'https://x/\x07\x1b]0;owned\x07' }), false);
});
void test('isFormattedData validates element shape per fieldType', () => {
    assert.equal(isFormattedData({ suggestStyle: 0, field: 'x', fieldType: 'STRING' }), true);
    assert.equal(isFormattedData({ suggestStyle: 3, field: '2026-06-12T00:00:00Z', fieldType: 'DATE' }), true);
    assert.equal(isFormattedData({ suggestStyle: 6, field: { name: 'n', location: 'https://x' }, fieldType: 'LINK' }), true);
    assert.equal(isFormattedData(null), false);
    assert.equal(isFormattedData({ suggestStyle: 'big', field: 'x', fieldType: 'STRING' }), false);
    assert.equal(isFormattedData({ suggestStyle: 0, field: 7, fieldType: 'STRING' }), false);
    assert.equal(isFormattedData({ suggestStyle: 0, field: 'x', fieldType: 'BLINK' }), false);
    assert.equal(isFormattedData({ suggestStyle: 0, field: 'not a link', fieldType: 'LINK' }), false);
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
    const { ts, ...withoutTs } = validPacket;
    void ts;
    assert.equal(isFfluidityPacket(withoutTs), false);
    assert.equal(isFfluidityPacket({ ...validPacket, ts: 'not a date' }), false);
    assert.equal(isFfluidityPacket({ ...validPacket, formattedData: [null] }), false);
    assert.equal(isFfluidityPacket({ ...validPacket, formattedData: [{ junk: true }] }), false);
    const { formattedData, ...withoutFormatted } = validPacket;
    void formattedData;
    assert.equal(isFfluidityPacket(withoutFormatted), false);
    const { ts: ts2, ...paramsShape } = withoutFormatted;
    void ts2;
    assert.equal(isFfluidityPacket(paramsShape, true), true);
});
void test('stripControlChars removes C0, DEL, and C1 controls', () => {
    assert.equal(stripControlChars('plain text'), 'plain text');
    assert.equal(stripControlChars('a\x1b[31mb\x07c\x7fd'), 'a[31mbcd');
    assert.equal(stripControlChars('x\u009b31my\u009d0;t'), 'x31my0;t');
});
void test('shared utils: counter, isErrnoException', () => {
    const c = counter();
    assert.deepEqual([c.next().value, c.next().value, c.next().value], [1, 2, 3]);
    const errno = new Error('boom');
    errno.code = 'ENOENT';
    assert.equal(isErrnoException(errno), true);
    assert.equal(isErrnoException(new Error('plain')), false);
});
