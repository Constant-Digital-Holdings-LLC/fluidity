import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettyFsNotFound, isErrnoException, nodeEnv, counter } from '#@shared/modules/utils.js';

//coverage for shared/utils - prettyFsNotFound was under-tested (54%) and the
//audit fixed an unsettled-promise path in it; pin its behavior here.

const enoent = (path?: string): NodeJS.ErrnoException =>
    Object.assign(new Error('ENOENT'), { code: 'ENOENT', ...(path !== undefined ? { path } : {}) });

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
    //a plain error: not file-not-found, so nothing pretty to say - but the
    //promise must still settle (the audit's concern was a hanging caller)
    assert.equal(await prettyFsNotFound(new Error('some other failure')), undefined);
    assert.equal(await prettyFsNotFound(Object.assign(new Error('perm'), { code: 'EACCES' })), undefined);
});

void test('isErrnoException recognizes errors carrying code/errno', () => {
    assert.equal(isErrnoException(enoent('x')), true);
    assert.equal(isErrnoException(Object.assign(new Error(), { errno: -2 })), true);
    assert.equal(isErrnoException(new Error('plain')), false);
});

void test('nodeEnv classifies the environment (development only when explicit)', () => {
    //the same helper gates the agent's TLS verification and the config
    //loader's file choice - it must read NODE_ENV one way, everywhere
    assert.equal(nodeEnv(), process.env['NODE_ENV'] === 'development' ? 'development' : 'production');
});

void test('counter yields a monotonic sequence from 1', () => {
    const c = counter();
    assert.deepEqual([c.next().value, c.next().value, c.next().value], [1, 2, 3]);
});
