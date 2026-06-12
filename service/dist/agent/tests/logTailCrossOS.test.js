import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, truncateSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LogTailCollector from '../modules/collectors/logTail.js';
class OsSimLogTail extends LogTailCollector {
    lines = [];
    ino = 1;
    birthMs = 1000;
    pollOnce() {
        return this.poll();
    }
    async statFile() {
        const real = await super.statFile();
        if (!real)
            return null;
        return { isFile: real.isFile, size: real.size, ino: this.ino, birthMs: this.birthMs };
    }
    send(data) {
        this.lines.push(data);
    }
}
const dir = mkdtempSync(join(tmpdir(), 'flu-logtail-os-'));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const tmpFile = () => join(dir, `os-${n++}.log`);
const params = (path, over = {}) => ({
    plugin: 'logTail',
    description: 'cross-os',
    site: 'test-site',
    targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
    path,
    fromStart: true,
    ...over
});
void test('Linux/Unix: rotation detected by a changing inode', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new OsSimLogTail(params(f));
    c.ino = 100;
    c.birthMs = 5000;
    appendFileSync(f, 'a\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a']);
    renameSync(f, `${f}.1`);
    writeFileSync(f, 'b\n');
    c.ino = 101;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a', 'b']);
    c.stop();
});
void test('Windows/FAT: inode reported 0, rotation detected via creation-time fallback', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new OsSimLogTail(params(f));
    c.ino = 0;
    c.birthMs = 1000;
    appendFileSync(f, 'a\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a']);
    renameSync(f, `${f}.1`);
    writeFileSync(f, 'b\n');
    c.birthMs = 2000;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a', 'b'], 'birthtime change caught the rotation when inode could not');
    c.stop();
});
void test('worst case (inode 0 AND creation time unchanged): size-shrink still catches a fresh file', async () => {
    const f = tmpFile();
    writeFileSync(f, 'old1\nold2\nold3\n');
    const c = new OsSimLogTail(params(f));
    c.ino = 0;
    c.birthMs = 1000;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['old1', 'old2', 'old3']);
    renameSync(f, `${f}.1`);
    writeFileSync(f, 'new1\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['old1', 'old2', 'old3', 'new1'], 'truncation path recovers when identity is blind');
    c.stop();
});
void test('macOS / editors: atomic save (write temp + rename over) is handled as rotation', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new OsSimLogTail(params(f));
    c.ino = 200;
    c.birthMs = 3000;
    appendFileSync(f, 'before\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['before']);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, 'after\n');
    renameSync(tmp, f);
    c.ino = 201;
    c.birthMs = 3001;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['before', 'after']);
    c.stop();
});
void test('logrotate copytruncate: same inode, size reset to 0 in place', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new OsSimLogTail(params(f));
    c.ino = 300;
    c.birthMs = 4000;
    appendFileSync(f, 'x\ny\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['x', 'y']);
    truncateSync(f, 0);
    appendFileSync(f, 'z\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['x', 'y', 'z']);
    c.stop();
});
void test('Windows CRLF: \\r and \\n landing in separate reads still yield clean lines', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new OsSimLogTail(params(f));
    appendFileSync(f, 'a\r');
    await c.pollOnce();
    assert.deepEqual(c.lines, [], 'no line yet - the \\n has not arrived');
    appendFileSync(f, '\nb\r\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a', 'b'], 'CRLF split across reads is reassembled and stripped');
    c.stop();
});
void test('Windows UTF-8 BOM at file start is stripped (also after rotation)', async () => {
    const f = tmpFile();
    writeFileSync(f, '\uFEFFfirst\nsecond\n');
    const c = new OsSimLogTail(params(f));
    c.ino = 400;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['first', 'second'], 'leading BOM not leaked into the first field');
    renameSync(f, `${f}.1`);
    writeFileSync(f, '\uFEFFthird\n');
    c.ino = 401;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['first', 'second', 'third'], 'BOM stripped again at the new file start');
    c.stop();
});
