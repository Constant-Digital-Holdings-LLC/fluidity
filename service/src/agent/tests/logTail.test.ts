import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, truncateSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isFfluidityPacket } from '#@shared/types.js';
import LogTailCollector from '../modules/collectors/logTail.js';
import { FileTailCollectorParams } from '../modules/collectors.js';
import { startTarget } from './helpers.js';

//drives one tail iteration deterministically (poll() is protected) and, by
//default, captures the lines that would be published instead of POSTing them.
class TestLogTail extends LogTailCollector {
    public captured: string[] = [];
    public capture = true;
    public pollOnce(): Promise<void> {
        return this.poll();
    }
    protected override send(data: string): void {
        if (this.capture) this.captured.push(data);
        else super.send(data);
    }
}

const dir = mkdtempSync(join(tmpdir(), 'flu-logtail-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const tmpFile = (): string => join(dir, `log-${n++}.log`);

const params = (path: string, over: Partial<FileTailCollectorParams> = {}): FileTailCollectorParams => ({
    plugin: 'logTail',
    description: 'log under test',
    site: 'test-site',
    targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
    path,
    ...over
});

void test('starts at EOF by default: pre-existing lines are skipped, only appends stream', async () => {
    const f = tmpFile();
    writeFileSync(f, 'old1\nold2\n');
    const c = new TestLogTail(params(f));
    await c.pollOnce(); //first attach: anchors at EOF
    assert.deepEqual(c.captured, [], 'nothing replayed from before we attached');

    appendFileSync(f, 'new1\nnew2\n');
    await c.pollOnce();
    assert.deepEqual(c.captured, ['new1', 'new2'], 'only lines appended after attach');
    c.stop();
});

void test('fromStart replays the whole file', async () => {
    const f = tmpFile();
    writeFileSync(f, 'a\nb\n');
    const c = new TestLogTail(params(f, { fromStart: true }));
    await c.pollOnce();
    assert.deepEqual(c.captured, ['a', 'b']);
    c.stop();
});

void test('a line split across writes is emitted once, whole', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new TestLogTail(params(f, { fromStart: true }));
    appendFileSync(f, 'hel');
    await c.pollOnce();
    assert.deepEqual(c.captured, [], 'no partial line emitted');
    appendFileSync(f, 'lo\n');
    await c.pollOnce();
    assert.deepEqual(c.captured, ['hello'], 'the partial joins its remainder');
    c.stop();
});

void test('a multibyte UTF-8 char split across reads is not corrupted', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new TestLogTail(params(f, { fromStart: true }));
    appendFileSync(f, Buffer.from([0xc3])); //lead byte of 'é' (U+00E9 = C3 A9)
    await c.pollOnce();
    assert.deepEqual(c.captured, [], 'incomplete char held back, not flushed as mojibake');
    appendFileSync(f, Buffer.concat([Buffer.from([0xa9]), Buffer.from('C\n', 'utf8')]));
    await c.pollOnce();
    assert.deepEqual(c.captured, ['éC'], 'the char completes across the read boundary');
    c.stop();
});

void test('rotation (rename + recreate) reads the fresh file from the start', async () => {
    const f = tmpFile();
    writeFileSync(f, 'a\n');
    const c = new TestLogTail(params(f, { fromStart: true }));
    await c.pollOnce();
    assert.deepEqual(c.captured, ['a']);

    renameSync(f, `${f}.1`); //logrotate: move the old file aside...
    writeFileSync(f, 'b\n'); //...and create a fresh one at the same path
    await c.pollOnce();
    assert.deepEqual(c.captured, ['a', 'b'], 'new inode -> read from offset 0, no loss');
    c.stop();
});

void test('in-place truncation resets to the new start', async () => {
    const f = tmpFile();
    writeFileSync(f, 'a\nb\n');
    const c = new TestLogTail(params(f, { fromStart: true }));
    await c.pollOnce();
    assert.deepEqual(c.captured, ['a', 'b']);

    truncateSync(f, 0); //file shrinks under our offset
    appendFileSync(f, 'c\n');
    await c.pollOnce();
    assert.deepEqual(c.captured, ['a', 'b', 'c'], 'reset to 0, did not skip past EOF');
    c.stop();
});

void test('CRLF is stripped and blank lines are dropped', async () => {
    const f = tmpFile();
    writeFileSync(f, 'x\r\n\n\ny\r\n');
    const c = new TestLogTail(params(f, { fromStart: true }));
    await c.pollOnce();
    assert.deepEqual(c.captured, ['x', 'y']);
    c.stop();
});

void test('a newline-less run is flushed (and counted) instead of buffering forever', async () => {
    const f = tmpFile();
    writeFileSync(f, '');
    const c = new TestLogTail(params(f, { fromStart: true, maxLineBytes: 8 }));
    appendFileSync(f, '0123456789abc'); //13 bytes, no newline, over the cap
    await c.pollOnce();
    assert.deepEqual(c.captured, ['0123456789abc'], 'flushed rather than held unbounded');
    assert.equal(c.dropCounts.get('oversize-line'), 1);
    c.stop();
});

void test('a missing file is tolerated until it appears', async () => {
    const f = tmpFile(); //never created yet
    const c = new TestLogTail(params(f, { fromStart: true }));
    await c.pollOnce(); //ENOENT: no throw, no capture, loop survives
    assert.deepEqual(c.captured, []);
    writeFileSync(f, 'hello\n');
    await c.pollOnce();
    assert.deepEqual(c.captured, ['hello'], 'picks up once the file exists');
    c.stop();
});

void test('the timer-driven loop tails a live append, then stop() releases it', async () => {
    const f = tmpFile();
    writeFileSync(f, 'first\n');
    const c = new TestLogTail(params(f, { fromStart: true, pollIntervalMs: 60 }));
    c.start();
    appendFileSync(f, 'second\n');
    await sleep(220); //a few poll cycles
    assert.deepEqual(c.captured, ['first', 'second']);
    c.stop();
    const at = c.captured.length;
    appendFileSync(f, 'after-stop\n');
    await sleep(150);
    assert.equal(c.captured.length, at, 'stop() halts the loop (and clears the timer so the process can exit)');
});

void test('e2e: a tailed line becomes a FluidityPacket on the publish path', async () => {
    const target = await startTarget();
    const f = tmpFile();
    writeFileSync(f, 'hello world\n');
    const c = new TestLogTail(
        params(f, { fromStart: true, targets: [{ location: target.location, key: 'loadtestkey1' }] })
    );
    c.capture = false; //use the real dispatch/HTTPS path
    await c.pollOnce();
    const body = await target.next();
    assert.ok(isFfluidityPacket(body), 'a valid FluidityPacket arrives upstream');
    const pkt = body;
    assert.equal(pkt.site, 'test-site');
    assert.equal(pkt.plugin, 'logTail');
    assert.deepEqual(pkt.formattedData, [{ suggestStyle: 0, field: 'hello world', fieldType: 'STRING' }]);
    c.stop();
    target.server.close();
});
