import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { setTimeout as sleep } from 'node:timers/promises';
import { isFfluidityPacket } from '#@shared/types.js';
import { mulberry32 } from '#@sims/prng.js';
import { packFluPacket, startUdpFleet } from '#@sims/udpDeviceSim.js';
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
    assert.equal(built.length, 1);
    assert.ok(built[0] instanceof UdpStructCollector);
    built.forEach(c => c.stop());
});
void test('udp: config validation refuses bad ports, bad binds, and unimplemented MAC mode', () => {
    assert.throws(() => new UdpStructCollector(udpParams({ port: -1 })), /port/);
    assert.throws(() => new UdpStructCollector(udpParams({ port: 70000 })), /port/);
    assert.throws(() => new UdpStructCollector(udpParams({ port: 1.5 })), /port/);
    assert.throws(() => new UdpStructCollector(udpParams({ bind: 5 })), /bind/);
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { requireMac: true } })), /U2/);
    assert.throws(() => new UdpStructCollector(udpParams({ extendedOptions: { secret: 'abc123' } })), /U2/);
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
