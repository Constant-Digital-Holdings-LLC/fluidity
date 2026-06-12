import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, truncateSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import LogTailCollector from '../modules/collectors/logTail.js';
import { FileTailCollectorParams, FileMeta } from '../modules/collectors.js';

//File tailing behaves differently across operating systems, and the test box
//is one OS. So rather than hope CI runs everywhere, this suite *emulates* each
//OS's stat behavior through the collector's statFile() seam while reading real
//bytes from a real file - the inode/creation-time signals each platform
//reports are injected, so the rotation/truncation logic is exercised under
//Windows/FAT/macOS conditions here on Linux. If something we didn't account
//for breaks on a real Windows/macOS run, it should break here first.
//
//Emulated gotchas:
//  - Linux/Unix: stable, changing inode on rotation (the baseline)
//  - Windows/FAT: ino reported 0/unreliable -> creation-time fallback
//  - the worst case (ino 0 AND creation time unchanged) -> size-shrink still saves it
//  - macOS / editors: atomic save (write temp + rename over the path)
//  - logrotate copytruncate: same inode, size reset to 0 in place
//  - Windows CRLF where \r and \n land in different reads
//  - UTF-8 BOM at a file's start (Windows editors), incl. after rotation
//
//Not emulable on Linux (documented, not tested): Windows mandatory file locks.
//The tailer opens the file read-only and closes it each poll (never holding a
//handle across polls), which is the mitigation - it does not block a rename.

//injects the (ino, birthMs) a given OS would report; reads real bytes.
class OsSimLogTail extends LogTailCollector {
    public lines: string[] = [];
    public ino = 1;
    public birthMs = 1000;
    public pollOnce(): Promise<void> {
        return this.poll();
    }
    protected override async statFile(): Promise<FileMeta | null> {
        const real = await super.statFile();
        if (!real) return null;
        return { isFile: real.isFile, size: real.size, ino: this.ino, birthMs: this.birthMs };
    }
    protected override send(data: string): void {
        this.lines.push(data);
    }
}

const dir = mkdtempSync(join(tmpdir(), 'flu-logtail-os-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const tmpFile = (): string => join(dir, `os-${n++}.log`);
const params = (path: string, over: Partial<FileTailCollectorParams> = {}): FileTailCollectorParams => ({
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

    //logrotate rename + recreate; Unix gives the fresh file a new inode
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
    c.ino = 0; //FAT/some Windows FS report 0 - inode is useless as identity
    c.birthMs = 1000;
    appendFileSync(f, 'a\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a']);

    renameSync(f, `${f}.1`);
    writeFileSync(f, 'b\n');
    c.birthMs = 2000; //the fresh file has a new creation time
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a', 'b'], 'birthtime change caught the rotation when inode could not');
    c.stop();
});

void test('worst case (inode 0 AND creation time unchanged): size-shrink still catches a fresh file', async () => {
    const f = tmpFile();
    writeFileSync(f, 'old1\nold2\nold3\n');
    const c = new OsSimLogTail(params(f));
    c.ino = 0;
    c.birthMs = 1000; //never changes -> identity is blind to rotation
    await c.pollOnce();
    assert.deepEqual(c.lines, ['old1', 'old2', 'old3']);

    //a fresh, smaller file at the path: identity can't tell, but the size drop does
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

    //atomic save: a new file is built elsewhere and renamed over the path
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
    c.ino = 300; //unchanged throughout - copytruncate keeps the same file
    c.birthMs = 4000;
    appendFileSync(f, 'x\ny\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['x', 'y']);

    truncateSync(f, 0); //copy-then-truncate-in-place: identity stays, size drops
    appendFileSync(f, 'z\n');
    await c.pollOnce();
    assert.deepEqual(c.lines, ['x', 'y', 'z']);
    c.stop();
});

void test('Windows CRLF: \\r and \\n landing in separate reads still yield clean lines', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new OsSimLogTail(params(f));
    appendFileSync(f, 'a\r'); //the \r arrives this poll...
    await c.pollOnce();
    assert.deepEqual(c.lines, [], 'no line yet - the \\n has not arrived');
    appendFileSync(f, '\nb\r\n'); //...the \n (and another CRLF line) the next
    await c.pollOnce();
    assert.deepEqual(c.lines, ['a', 'b'], 'CRLF split across reads is reassembled and stripped');
    c.stop();
});

void test('Windows UTF-8 BOM at file start is stripped (also after rotation)', async () => {
    const f = tmpFile();
    writeFileSync(f, '\uFEFFfirst\nsecond\n'); //editor-written BOM
    const c = new OsSimLogTail(params(f));
    c.ino = 400;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['first', 'second'], 'leading BOM not leaked into the first field');

    //a rotated-in file that also starts with a BOM
    renameSync(f, `${f}.1`);
    writeFileSync(f, '\uFEFFthird\n');
    c.ino = 401;
    await c.pollOnce();
    assert.deepEqual(c.lines, ['first', 'second', 'third'], 'BOM stripped again at the new file start');
    c.stop();
});
