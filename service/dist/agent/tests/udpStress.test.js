import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { setTimeout as sleep } from 'node:timers/promises';
import { runUdpStress } from '#@sims/udpStressEmitter.js';
import { packFluPacket, signFluPacket } from '#@sims/udpDeviceSim.js';
import { sipKeyFromHex } from '#@sims/siphash.js';
import UdpStructCollector from '../modules/collectors/udpStruct.js';
import { startTarget } from './helpers.js';
const SECRET = 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
const KEY = sipKeyFromHex(SECRET);
const mkCollector = (over = {}) => new UdpStructCollector({
    plugin: 'udpStruct',
    description: 'stress target',
    site: 'agent-site',
    targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
    port: 0,
    bind: '127.0.0.1',
    ...over
});
const sumCounts = (c, keys) => keys.reduce((acc, k) => acc + (c.dropCounts.get(k) ?? 0), 0);
void test('udp stress: mixed barrage at 1500pps - exact send counts, sane drop reconciliation, survival', async () => {
    const target = await startTarget();
    const collector = mkCollector({
        targets: [{ location: target.location, key: 'stresskey1' }],
        maxHttpsReqPerCollectorPerSec: 100,
        extendedOptions: { secret: SECRET, requireMac: true }
    });
    collector.start();
    const port = await collector.ready();
    try {
        const report = await runUdpStress({
            port,
            rate: 1500,
            durationSec: 1,
            devices: 40,
            mix: { valid: 5, garbage: 60, tampered: 25, unsigned: 10 },
            secret: SECRET,
            seed: 0xfeed
        }).done;
        assert.equal(report.totalSent, 1500);
        const catSum = Object.values(report.perCategory).reduce((a, b) => a + b, 0);
        assert.equal(catSum, 1500, 'categories partition the total');
        assert.equal(report.sendErrors, 0, 'loopback sends never error');
        assert.ok(report.perCategory.valid > 0 && report.perCategory.garbage > 0);
        await sleep(800);
        const badMac = collector.dropCounts.get('bad-mac') ?? 0;
        const macBound = report.perCategory.tampered + report.perCategory.unsigned;
        assert.ok(badMac >= macBound / 2, `bad-mac ${badMac} should be most of ${macBound}`);
        assert.ok(badMac <= macBound, 'bad-mac never exceeds what was mis-signed');
        const garbageDrops = sumCounts(collector, [
            'bad-length',
            'not-fluidity',
            'bad-version',
            'bad-fields',
            'bad-encoding',
            'bad-identity'
        ]);
        assert.ok(garbageDrops >= report.perCategory.garbage / 2, `garbage drops ${garbageDrops} should be most of ${report.perCategory.garbage}`);
        assert.ok(garbageDrops <= report.perCategory.garbage, 'never over-counted');
        target.received.forEach(p => {
            assert.match(p.site, /^stress-\d+$/);
        });
        const posted = target.next();
        const sentinel = signFluPacket(packFluPacket({ site: 'after-storm', plugin: 'p', deviceSeq: 1, fields: [{ style: 0, text: 'ok' }] }), KEY);
        const client = dgram.createSocket('udp4');
        await new Promise((res, rej) => client.send(sentinel, port, '127.0.0.1', e => (e ? rej(e) : res())));
        const after = (await posted);
        client.close();
        assert.equal(after.site, 'after-storm');
    }
    finally {
        collector.stop();
        target.server.close();
    }
});
void test('udp stress: a valid-packet flood is shed as backpressure, never queued without bound', async () => {
    const target = await startTarget();
    const collector = mkCollector({
        targets: [{ location: target.location, key: 'stresskey1' }],
        maxHttpsReqPerCollectorPerSec: 50
    });
    collector.start();
    const port = await collector.ready();
    try {
        const report = await runUdpStress({
            port,
            rate: 800,
            durationSec: 1,
            devices: 20,
            seed: 0xf100d
        }).done;
        assert.equal(report.totalSent, 800);
        await sleep(2300);
        const shed = collector.dropCounts.get('backpressure') ?? 0;
        assert.ok(shed >= 200, `expected substantial shedding, got ${shed}`);
        const published = target.received.length;
        assert.ok(published >= 20, `the admitted packets flow (${published})`);
        assert.ok(published <= 300, `the flood must not reach upstream (${published} of 800)`);
        assert.ok(shed + published <= report.totalSent, 'shed and published never exceed what was sent');
        const posted = target.next();
        const client = dgram.createSocket('udp4');
        const sentinel = packFluPacket({ site: 'calm', plugin: 'p', deviceSeq: 2, fields: [{ style: 0, text: 'ok' }] });
        await new Promise((res, rej) => client.send(sentinel, port, '127.0.0.1', e => (e ? rej(e) : res())));
        const after = (await posted);
        client.close();
        assert.equal(after.site, 'calm');
    }
    finally {
        collector.stop();
        target.server.close();
    }
});
void test('udp stress: same seed, same barrage - the emitter is deterministic sender-side', async () => {
    const sink = dgram.createSocket('udp4');
    await new Promise(resolve => sink.bind(0, '127.0.0.1', resolve));
    const { port } = sink.address();
    try {
        const opts = {
            port,
            rate: 500,
            durationSec: 0.5,
            devices: 10,
            mix: { valid: 50, garbage: 30, tampered: 15, unsigned: 5 },
            secret: SECRET,
            seed: 0x5eed
        };
        const a = await runUdpStress(opts).done;
        const b = await runUdpStress(opts).done;
        assert.equal(a.totalSent, 250);
        assert.equal(b.totalSent, 250);
        assert.deepEqual(a.perCategory, b.perCategory, 'identical seed, identical split');
    }
    finally {
        sink.close();
    }
});
void test('udp stress: misconfiguration is refused loudly', () => {
    assert.throws(() => runUdpStress({ rate: 0 }), /rate/);
    assert.throws(() => runUdpStress({ devices: 0 }), /devices/);
    assert.throws(() => runUdpStress({ mix: { valid: -1 } }), /weight/);
    assert.throws(() => runUdpStress({ mix: { garbage: 0 } }), /positive weight/);
    assert.throws(() => runUdpStress({ secret: 'nope' }), /32 hex/);
    assert.throws(() => runUdpStress({ mix: { tampered: 10 } }), /needs a secret/);
    assert.throws(() => runUdpStress({ mix: { unsigned: 10 } }), /needs a secret/);
});
