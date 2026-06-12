import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettyFsNotFound, isErrnoException, isJSONString, counter } from '#@shared/modules/utils.js';
const enoent = (path) => Object.assign(new Error('ENOENT'), { code: 'ENOENT', ...(path !== undefined ? { path } : {}) });
void test('prettyFsNotFound resolves a readable message for an ENOENT with a path', async () => {
    const msg = await prettyFsNotFound(enoent('./conf/missing.json'));
    assert.ok(msg, 'a message is produced');
    assert.match(msg, /Cannot find path:/);
    assert.match(msg, /missing\.json/, 'the offending path is named');
});
void test('prettyFsNotFound resolves undefined for an ENOENT without a path', async () => {
    assert.equal(await prettyFsNotFound(enoent()), undefined);
});
void test('prettyFsNotFound resolves undefined for a non-ENOENT error (always settles)', async () => {
    assert.equal(await prettyFsNotFound(new Error('some other failure')), undefined);
    assert.equal(await prettyFsNotFound(Object.assign(new Error('perm'), { code: 'EACCES' })), undefined);
});
void test('isErrnoException recognizes errors carrying code/errno', () => {
    assert.equal(isErrnoException(enoent('x')), true);
    assert.equal(isErrnoException(Object.assign(new Error(), { errno: -2 })), true);
    assert.equal(isErrnoException(new Error('plain')), false);
});
void test('isJSONString distinguishes valid JSON from garbage', () => {
    assert.equal(isJSONString('{"a":1}'), true);
    assert.equal(isJSONString('[]'), true);
    assert.equal(isJSONString('not json'), false);
    assert.equal(isJSONString('{unclosed'), false);
});
void test('counter yields a monotonic sequence from 1', () => {
    const c = counter();
    assert.deepEqual([c.next().value, c.next().value, c.next().value], [1, 2, 3]);
});
