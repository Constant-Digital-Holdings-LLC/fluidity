import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { setTimeout as sleep } from 'node:timers/promises';
import { isFfluidityPacket } from '#@shared/types.js';
import { mulberry32 } from '#@sims/prng.js';
import { sipKeyFromHex } from '#@sims/siphash.js';
import { packFluPacket, signFluPacket, startUdpFleet } from '#@sims/udpDeviceSim.js';
import { encodeFluPacket, decodeFluPacket } from '../modules/udpCodec.js';
import { buildCollectors } from '../modules/runner.js';
import UdpStructCollector from '../modules/collectors/udpStruct.js';
import { startTarget } from './helpers.js';
const udpParams = (over = {}) => ({
    plugin: 'udpStruct',
    description: 'LAN sensors under test',
    site: 'agent-site',
    targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
    port: 0,
    bind: '127.0.0.1',
    maxHttpsReqPerCollectorPerSec: 50,
    ...over
});
const liveCollector = async (over = {}) => {
    const collector = new UdpStructCollector(udpParams(over));
    collector.start();
    const port = await collector.ready();
    const client = dgram.createSocket('udp4');
    return {
        collector,
        client,
        port,
        close: () => {
            client.close();
            collector.stop();
        }
    };
};
const send = (client, port, buf) => new Promise((resolve, reject) => {
    client.send(buf, port, '127.0.0.1', err => (err ? reject(err) : resolve()));
});
void test('udpStruct defaults to a fleet upstream rate, not the base per-device 2', () => {
    const { maxHttpsReqPerCollectorPerSec: _unset, ...noThrottle } = udpParams();
    void _unset;
    const fleet = new UdpStructCollector(noThrottle);
    assert.equal(fleet.maxPostsPerSec, 1000);
    fleet.stop();
    const custom = new UdpStructCollector(udpParams({ maxHttpsReqPerCollectorPerSec: 4000 }));
    assert.equal(custom.maxPostsPerSec, 4000);
    custom.stop();
});
void test('udpStruct warns when the upstream throttle is too low for a fleet', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => void warnings.push(a.join(' '));
    try {
        new UdpStructCollector(udpParams({ maxHttpsReqPerCollectorPerSec: 2 })).stop();
    }
    finally {
        console.warn = origWarn;
    }
    assert.ok(warnings.some(w => /fleet aggregator/.test(w) && /maxHttpsReqPerCollectorPerSec=2\b/.test(w)), `expected a low-throttle fleet warning, got: ${JSON.stringify(warnings)}`);
});
void test('sim packer and agent encoder emit identical bytes for the same packet', () => {
    const logical = {
        site: 'greenhouse',
        plugin: 'm5-env',
        description: 'soil probe',
        deviceSeq: 7,
        fields: [
            { style: 2, text: 'temp 21.4C' },
            { style: 7, text: 'rh 64%' }
        ]
    };
    assert.ok(packFluPacket(logical).equals(encodeFluPacket(logical)), 'clockless form');
    assert.ok(packFluPacket({ ...logical, tsEpochSec: 1_765_000_000 }).equals(encodeFluPacket({ ...logical, tsEpochSec: 1_765_000_000 })), 'timestamped form');
});
void test('udp e2e: a datagram becomes a FluidityPacket on the HTTPS wire', async () => {
    const target = await startTarget();
    const live = await liveCollector({ targets: [{ location: target.location, key: 'udpkey1' }] });
    try {
        const posted = target.next();
        await send(live.client, live.port, packFluPacket({
            site: 'greenhouse',
            plugin: 'm5-env',
            description: 'soil probe',
            deviceSeq: 1,
            fields: [
                { style: 2, text: 'temp 21.4C' },
                { style: 7, text: 'rh 64%' }
            ]
        }));
        const packet = (await posted);
        assert.ok(isFfluidityPacket(packet), 'posted body must be a valid FluidityPacket');
        assert.equal(packet.site, 'greenhouse', 'site comes from the datagram (siteFromPacket default)');
        assert.equal(packet.plugin, 'm5-env', 'plugin comes from the datagram');
        assert.equal(packet.description, 'soil probe');
        assert.deepEqual(packet.formattedData, [
            { suggestStyle: 2, field: 'temp 21.4C', fieldType: 'STRING' },
            { suggestStyle: 7, field: 'rh 64%', fieldType: 'STRING' }
        ]);
        assert.equal(packet.rawData, null, 'keepRaw off by default');
        assert.ok(Math.abs(Date.parse(packet.ts) - Date.now()) < 10_000, 'clockless device: agent stamps arrival');
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp: device time is honored within a day and re-stamped beyond it', async () => {
    const target = await startTarget();
    const live = await liveCollector({ targets: [{ location: target.location, key: 'udpkey1' }] });
    try {
        const base = { site: 's1', plugin: 'p1', deviceSeq: 0, fields: [{ style: 0, text: 'tick' }] };
        const deviceSec = Math.floor(Date.now() / 1000) - 60;
        let posted = target.next();
        await send(live.client, live.port, packFluPacket({ ...base, tsEpochSec: deviceSec }));
        let packet = (await posted);
        assert.equal(packet.ts, new Date(deviceSec * 1000).toISOString(), 'sane device clock wins');
        const wildSec = deviceSec - 3 * 24 * 3600;
        posted = target.next();
        await send(live.client, live.port, packFluPacket({ ...base, deviceSeq: 1, tsEpochSec: wildSec }));
        packet = (await posted);
        assert.ok(Math.abs(Date.parse(packet.ts) - Date.now()) < 10_000, 'wild clock: agent re-stamps');
        assert.equal(live.collector.dropCounts.get('bad-time'), 1, 'wild clock is counted');
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp: siteFromPacket false stamps the agent site; empty description falls back to plugin', async () => {
    const target = await startTarget();
    const live = await liveCollector({
        targets: [{ location: target.location, key: 'udpkey1' }],
        extendedOptions: { siteFromPacket: false }
    });
    try {
        const posted = target.next();
        await send(live.client, live.port, packFluPacket({ site: 'gate-1', plugin: 'avr-door', deviceSeq: 0, fields: [{ style: 5, text: 'OPEN' }] }));
        const packet = (await posted);
        assert.equal(packet.site, 'agent-site', 'agent identity preserved');
        assert.equal(packet.description, 'avr-door', 'empty description renders as the plugin name');
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp: keepRaw forwards the datagram as lowercase hex', async () => {
    const target = await startTarget();
    const live = await liveCollector({ targets: [{ location: target.location, key: 'udpkey1' }], keepRaw: true });
    try {
        const wire = packFluPacket({ site: 's1', plugin: 'p1', deviceSeq: 2, fields: [{ style: 1, text: 'raw' }] });
        const posted = target.next();
        await send(live.client, live.port, wire);
        const packet = (await posted);
        assert.equal(packet.rawData, wire.toString('hex'));
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp: malformed datagrams never reach the wire and are counted by reason', async () => {
    const target = await startTarget();
    const live = await liveCollector({ targets: [{ location: target.location, key: 'udpkey1' }] });
    try {
        await send(live.client, live.port, Buffer.from('not a fluidity packet'));
        await sleep(5);
        const alien = packFluPacket({ site: 's', plugin: 'p', deviceSeq: 0, fields: [{ style: 0, text: 'x' }] });
        alien.write('MQTT', 0, 'latin1');
        await send(live.client, live.port, alien);
        await sleep(5);
        const v9 = packFluPacket({ site: 's', plugin: 'p', deviceSeq: 0, fields: [{ style: 0, text: 'x' }] });
        v9[4] = 9;
        await send(live.client, live.port, v9);
        await sleep(5);
        const nameless = packFluPacket({ site: ' ', plugin: 'p', deviceSeq: 0, fields: [{ style: 0, text: 'x' }] });
        await send(live.client, live.port, nameless);
        await sleep(5);
        const posted = target.next();
        await send(live.client, live.port, packFluPacket({ site: 'ok', plugin: 'p', deviceSeq: 1, fields: [{ style: 0, text: 'alive' }] }));
        await posted;
        await sleep(50);
        assert.equal(target.received.length, 1, 'only the sentinel was published');
        assert.equal(live.collector.dropCounts.get('bad-length'), 1);
        assert.equal(live.collector.dropCounts.get('not-fluidity'), 1);
        assert.equal(live.collector.dropCounts.get('bad-version'), 1);
        assert.equal(live.collector.dropCounts.get('bad-identity'), 1);
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp: fuzz through the real socket - random datagrams, zero packets out, zero crashes', async () => {
    const target = await startTarget();
    const live = await liveCollector({ targets: [{ location: target.location, key: 'udpkey1' }] });
    try {
        const rnd = mulberry32(0xdead);
        const sent = 300;
        for (let i = 0; i < sent; i++) {
            const len = 1 + Math.floor(rnd() * 260);
            const buf = Buffer.alloc(len);
            for (let b = 0; b < len; b++)
                buf[b] = Math.floor(rnd() * 256);
            await send(live.client, live.port, buf);
            if (i % 20 === 19)
                await sleep(2);
        }
        const sentinel = packFluPacket({
            site: 'still-here',
            plugin: 'p',
            deviceSeq: 9,
            fields: [{ style: 0, text: 'ok' }]
        });
        let landed = false;
        for (let attempt = 0; attempt < 20 && !landed; attempt++) {
            const posted = target.next();
            await send(live.client, live.port, sentinel);
            landed = await Promise.race([posted.then(() => true), sleep(250).then(() => false)]);
        }
        await sleep(50);
        assert.ok(landed, 'collector must still publish after the barrage');
        assert.ok(target.received.length >= 1);
        target.received.forEach(p => {
            assert.equal(p.site, 'still-here', 'no fuzz datagram was ever published');
        });
        let counted = 0;
        live.collector.dropCounts.forEach(n => (counted += n));
        assert.ok(counted >= sent / 2, `most of the barrage must be counted (got ${counted}/${sent})`);
        assert.ok(counted <= sent, 'never over-counted');
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp: the runner constructs udpStruct from a config stanza', async () => {
    const built = await buildCollectors({
        appName: 'Fluidity',
        appVersion: 'test',
        site: 'test-site',
        targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
        collectors: [{ description: 'LAN sensors', plugin: 'udpStruct', port: 0, bind: '127.0.0.1' }]
    });
    assert.equal(built.length, 2);
    assert.ok(built[0] instanceof UdpStructCollector);
    assert.deepEqual(built.map(c => c.params.plugin), ['udpStruct', 'vRep']);
    built.forEach(c => c.stop());
});
void test('udp: config validation refuses bad ports and bad binds', () => {
    assert.throws(() => new UdpStructCollector(udpParams({ port: -1 })), /port/);
    assert.throws(() => new UdpStructCollector(udpParams({ port: 70000 })), /port/);
    assert.throws(() => new UdpStructCollector(udpParams({ port: 1.5 })), /port/);
    assert.throws(() => new UdpStructCollector(udpParams({ bind: 5 })), /bind/);
});
void test('udp: sim fleet once-mode burst decodes cleanly via the agent codec', async () => {
    const server = dgram.createSocket('udp4');
    const datagrams = [];
    let burst;
    server.on('message', msg => {
        datagrams.push(Buffer.from(msg));
        if (datagrams.length === 3)
            burst?.();
    });
    await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const fleet = startUdpFleet({ host: '127.0.0.1', port, once: true, seed: 42 });
    try {
        await Promise.all([fleet.done, new Promise(resolve => (burst = resolve))]);
        assert.equal(datagrams.length, 3, 'one datagram per simulated device');
        const decoded = datagrams.map(d => {
            const r = decodeFluPacket(d);
            assert.ok(r.ok, `fleet datagram must decode: ${r.ok ? '' : r.reason}`);
            return r.packet;
        });
        assert.deepEqual(decoded.map(p => p.site).sort(), ['gate-1', 'greenhouse', 'water-tank']);
        const clocked = decoded.find(p => p.site === 'greenhouse');
        assert.ok(clocked?.tsEpochMs, 'the NTP-equipped device ships time');
        assert.ok(Math.abs(clocked.tsEpochMs - Date.now()) < 10_000);
        decoded
            .filter(p => p.site !== 'greenhouse')
            .forEach(p => assert.equal(p.tsEpochMs, null, 'clockless devices ship no time'));
    }
    finally {
        fleet.stop();
        server.close();
    }
});
void test('udp: sim fleet continuous mode reschedules each device past its first beat', async () => {
    const server = dgram.createSocket('udp4');
    const bySite = new Map();
    server.on('message', msg => {
        const r = decodeFluPacket(Buffer.from(msg));
        if (r.ok)
            bySite.set(r.packet.site, (bySite.get(r.packet.site) ?? 0) + 1);
    });
    await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const fleet = startUdpFleet({ host: '127.0.0.1', port, seed: 7, heartbeatMs: { min: 8, max: 16 } });
    try {
        for (let waited = 0; waited < 60 && (bySite.get('gate-1') ?? 0) < 4; waited++)
            await sleep(20);
        assert.ok((bySite.get('gate-1') ?? 0) >= 4, `gate-1 rescheduled repeatedly (${bySite.get('gate-1')} beats)`);
        assert.ok(bySite.size >= 3, 'every device in the fleet is publishing');
    }
    finally {
        fleet.stop();
        server.close();
    }
});
const SECRET = 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
const KEY = sipKeyFromHex(SECRET);
const tick = (site, deviceSeq, text) => packFluPacket({ site, plugin: 'm5-env', deviceSeq, fields: [{ style: 0, text }] });
void test('udp MAC mode: genuine trailers publish; tampered and unsigned drop as bad-mac', async () => {
    const target = await startTarget();
    const live = await liveCollector({
        targets: [{ location: target.location, key: 'udpkey1' }],
        extendedOptions: { secret: SECRET, requireMac: true }
    });
    try {
        let posted = target.next();
        await send(live.client, live.port, signFluPacket(tick('signed-ok', 1, 'hello'), KEY));
        const first = (await posted);
        assert.equal(first.site, 'signed-ok');
        assert.equal(live.collector.dropCounts.get('bad-mac'), undefined);
        const tampered = signFluPacket(tick('signed-ok', 2, 'hello'), KEY);
        tampered[70] = (tampered[70] ?? 0) ^ 0x01;
        await send(live.client, live.port, tampered);
        await sleep(5);
        await send(live.client, live.port, tick('unsigned-dev', 3, 'hello'));
        await sleep(5);
        posted = target.next();
        await send(live.client, live.port, signFluPacket(tick('signed-ok', 4, 'still here'), KEY));
        await posted;
        await sleep(20);
        assert.equal(target.received.length, 2, 'only the two genuine packets published');
        assert.equal(live.collector.dropCounts.get('bad-mac'), 2, 'one tampered + one unsigned');
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp migration mode: unsigned accepted and counted; a bad signature still drops', async () => {
    const target = await startTarget();
    const live = await liveCollector({
        targets: [{ location: target.location, key: 'udpkey1' }],
        extendedOptions: { secret: SECRET, requireMac: false }
    });
    try {
        let posted = target.next();
        await send(live.client, live.port, tick('legacy-dev', 1, 'not migrated yet'));
        const legacy = (await posted);
        assert.equal(legacy.site, 'legacy-dev', 'unsigned publishes during migration');
        assert.equal(live.collector.dropCounts.get('unsigned'), 1, 'and is counted');
        posted = target.next();
        await send(live.client, live.port, signFluPacket(tick('new-dev', 1, 'migrated'), KEY));
        const migrated = (await posted);
        assert.equal(migrated.site, 'new-dev');
        const forged = signFluPacket(tick('evil-dev', 1, 'spoof'), KEY);
        forged[forged.length - 1] = (forged[forged.length - 1] ?? 0) ^ 0xff;
        await send(live.client, live.port, forged);
        await sleep(50);
        assert.equal(live.collector.dropCounts.get('bad-mac'), 1);
        assert.equal(target.received.length, 2);
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp open mode: a signed packet flows, trailer ignored', async () => {
    const target = await startTarget();
    const live = await liveCollector({ targets: [{ location: target.location, key: 'udpkey1' }] });
    try {
        const posted = target.next();
        await send(live.client, live.port, signFluPacket(tick('keen-dev', 1, 'signed anyway'), KEY));
        const packet = (await posted);
        assert.equal(packet.site, 'keen-dev');
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp auth config: misconfigured security refuses to start', () => {
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { secret: 'tooshort' } })), /32 hex/);
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { secret: SECRET + '00' } })), /32 hex/);
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { secret: 42 } })), /32 hex/);
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { requireMac: true } })), /secret/);
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { secret: SECRET, requireMac: 'yes' } })), /boolean/);
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { replayWindow: 64 } })), /secret/);
    for (const bad of [0, 1025, 1.5, '64']) {
        assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { secret: SECRET, replayWindow: bad } })), /1\.\.1024/);
    }
});
void test('udp replay window: replays drop, jumps re-anchor on coherence, reboot costs one packet', async () => {
    const target = await startTarget();
    const live = await liveCollector({
        targets: [{ location: target.location, key: 'udpkey1' }],
        extendedOptions: { secret: SECRET, requireMac: true, replayWindow: 16 }
    });
    const signedTick = (seq, text) => signFluPacket(tick('seq-dev', seq, text), KEY);
    const replays = () => live.collector.dropCounts.get('replay') ?? 0;
    try {
        let posted = target.next();
        await send(live.client, live.port, signedTick(10, 't1'));
        await posted;
        await send(live.client, live.port, signedTick(10, 't1'));
        await sleep(5);
        posted = target.next();
        await send(live.client, live.port, signedTick(11, 't2'));
        await posted;
        assert.equal(replays(), 1, 'the replay was counted');
        await send(live.client, live.port, signedTick(31, 't3'));
        await sleep(5);
        assert.equal(replays(), 2);
        posted = target.next();
        await send(live.client, live.port, signedTick(32, 't4'));
        await posted;
        await send(live.client, live.port, signedTick(0, 't5'));
        await sleep(5);
        assert.equal(replays(), 3);
        posted = target.next();
        await send(live.client, live.port, signedTick(1, 't6'));
        await posted;
        await sleep(20);
        const texts = target.received.map(p => p.formattedData[0]?.field);
        assert.deepEqual(texts, ['t1', 't2', 't4', 't6'], 'exactly the in-window packets published, in order');
    }
    finally {
        live.close();
        target.server.close();
    }
});
void test('udp signed sim fleet passes a MAC-required collector end-to-end', async () => {
    const target = await startTarget();
    const live = await liveCollector({
        targets: [{ location: target.location, key: 'udpkey1' }],
        extendedOptions: { secret: SECRET, requireMac: true, replayWindow: 64 }
    });
    try {
        const fleet = startUdpFleet({ host: '127.0.0.1', port: live.port, once: true, seed: 11, secret: SECRET });
        await fleet.done;
        for (let waited = 0; target.received.length < 3 && waited < 100; waited++)
            await sleep(20);
        assert.equal(target.received.length, 3, 'every signed fleet packet published');
        assert.deepEqual(target.received.map(p => p.site).sort(), [
            'gate-1',
            'greenhouse',
            'water-tank'
        ]);
        assert.equal(live.collector.dropCounts.get('bad-mac'), undefined, 'no MAC complaints');
    }
    finally {
        live.close();
        target.server.close();
    }
});
