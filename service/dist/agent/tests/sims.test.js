import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simProfileFromPath, mulberry32, srsLineStream, genericLineStream, startFeeder, genericLines, genericBanner, portFrame, defaultSrsConfig } from '#@sims/index.js';
const RADIO_FRAME = /^\[([0-9a-f]{2} ){4}[0-9a-f]{2}\]$/;
const PORT_FRAME = /^\{([0-9a-f]{2} ){5}[0-9a-f]{2}\}$/;
const take = (gen, n) => Array.from({ length: n }, () => gen.next().value);
const frameBytes = (line) => line
    .slice(1, -1)
    .split(' ')
    .map(b => parseInt(b, 16));
void test('simProfileFromPath resolves sim schemes and rejects device paths', () => {
    assert.equal(simProfileFromPath('sim://srs')?.name, 'srs');
    assert.equal(simProfileFromPath('sim://SRS')?.name, 'srs');
    assert.equal(simProfileFromPath('sim://generic')?.name, 'generic');
    assert.equal(simProfileFromPath('sim://nonexistent'), undefined);
    assert.equal(simProfileFromPath('/dev/ttyUSB0'), undefined);
    assert.equal(simProfileFromPath('COM4'), undefined);
});
void test('mulberry32 is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    assert.deepEqual(seqA, seqB);
    seqA.forEach(n => assert.ok(n >= 0 && n < 1));
});
void test('srs stream is deterministic and emits only well-formed frames', () => {
    const first = take(srsLineStream(mulberry32(7)), 200);
    const second = take(srsLineStream(mulberry32(7)), 200);
    assert.deepEqual(first, second);
    first.forEach(({ afterMs, line }) => {
        assert.ok(afterMs >= 0);
        assert.ok(RADIO_FRAME.test(line) || PORT_FRAME.test(line), `malformed frame: ${line}`);
    });
});
void test('srs port-state frames are a constant signature on a 100s heartbeat', () => {
    const events = take(srsLineStream(mulberry32(11)), 300);
    let now = 0;
    const portFrameTimes = [];
    const portFrameValues = new Set();
    events.forEach(({ afterMs, line }) => {
        now += afterMs;
        if (PORT_FRAME.test(line)) {
            portFrameTimes.push(now);
            portFrameValues.add(line);
        }
    });
    assert.ok(portFrameTimes.length >= 3, 'expected several heartbeats in sample');
    assert.equal(portFrameValues.size, 1, 'port-state signature should be constant');
    assert.equal([...portFrameValues][0], portFrame(defaultSrsConfig));
    portFrameTimes.slice(1).forEach((t, i) => {
        assert.equal(t - (portFrameTimes[i] ?? 0), defaultSrsConfig.heartbeatMs);
    });
    const [linked, loopback, disabled, sudisabled, split, interfaced] = frameBytes(portFrame(defaultSrsConfig));
    assert.equal((linked ?? 0) & ~(interfaced ?? 0), 0, 'LINK must be a subset of INTERFACED');
    assert.equal(disabled, 0);
    assert.equal(sudisabled, 0);
    assert.equal(split, 0);
    assert.ok(loopback !== undefined);
});
void test('srs radio-state frames model single-port COR with release-to-zero', () => {
    const events = take(srsLineStream(mulberry32(23)), 300);
    const radio = events.map(e => e.line).filter(l => RADIO_FRAME.test(l));
    assert.ok(radio.some(l => frameBytes(l).some(b => b !== 0)), 'sample should contain COR activity');
    assert.ok(radio.some(l => frameBytes(l).every(b => b === 0)), 'sample should contain release/heartbeat zero frames');
    let prevCor = 0;
    radio.forEach(line => {
        const [cor = 0, pl = 0, rcv = 0, dtmf = 0, ptt = 0] = frameBytes(line);
        assert.ok((cor & (cor - 1)) === 0, `multi-port COR unrealistic: ${line}`);
        assert.equal(rcv & ~cor, 0, `RCVACT without COR: ${line}`);
        assert.equal(pl, 0);
        assert.equal(dtmf, 0);
        assert.equal(ptt, 0);
        if (cor && prevCor) {
            assert.equal(cor, prevCor, `port changed without release: ${line}`);
        }
        prevCor = cor;
    });
});
void test('generic stream yields sketch lines at the sketch cadence', () => {
    const events = take(genericLineStream(mulberry32(5)), 100);
    events.forEach(({ afterMs, line }) => {
        assert.ok(afterMs >= 250 && afterMs < 10000);
        assert.ok(genericLines.includes(line));
    });
    assert.equal(simProfileFromPath('sim://generic')?.banner, genericBanner);
    assert.equal(simProfileFromPath('sim://srs')?.banner, undefined, 'real SRS controllers emit no banner');
});
void test('feeder writes optional banner then delimited lines from the source', async () => {
    const stub = {
        name: 'stub',
        banner: 'hello',
        delimiter: '\r\n',
        source: function* () {
            for (;;) {
                yield { afterMs: 0, line: 'x' };
            }
        }
    };
    const chunks = await new Promise(resolve => {
        const seen = [];
        const feeder = startFeeder(stub, chunk => {
            seen.push(chunk);
            if (seen.length >= 3) {
                feeder.stop();
                resolve(seen);
            }
        });
    });
    assert.deepEqual(chunks, ['hello\r\n', 'x\r\n', 'x\r\n']);
});
