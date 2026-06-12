import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { isFfluidityPacket } from '#@shared/types.js';
import { DataCollector, WebJSONCollector } from '../modules/collectors.js';
import { MockPortSRSCollector, srsParams, startTarget, tlsOptions } from './helpers.js';
void test('serial data flows through the collector onto the wire as a FluidityPacket', async () => {
    const target = await startTarget();
    try {
        const collector = new MockPortSRSCollector(srsParams('/test/pipeline-1', {
            targets: [{ location: target.location, key: 'pipelinekey1' }],
            extendedOptions: { portmap: ['Repeater440'], suppress: [] }
        }));
        const posted = target.next();
        collector.start();
        await once(collector.mockPort, 'open');
        collector.mockPort.port?.emitData('[01 00 00 00 00]\r\n');
        const packet = (await posted);
        assert.ok(isFfluidityPacket(packet), 'posted body must be a valid FluidityPacket');
        assert.equal(packet.site, 'test');
        assert.equal(packet.plugin, 'srsSerial');
        assert.deepEqual(packet.formattedData.map(f => f.field), ['Radio States: ', 'Repeater440:', 'COR']);
    }
    finally {
        target.server.close();
    }
});
void test('post() resolves on any 2xx response (regression: only 200 was accepted)', async () => {
    const target = await startTarget(201);
    try {
        const collector = new MockPortSRSCollector(srsParams('/test/pipeline-2', { targets: [{ location: target.location, key: 'pipelinekey1' }] }));
        await assert.doesNotReject(collector.testPost(target.location, { probe: true }, 'pipelinekey1'));
    }
    finally {
        target.server.close();
    }
});
void test('post() rejects on a 5xx response', async () => {
    const target = await startTarget(500);
    try {
        const collector = new MockPortSRSCollector(srsParams('/test/pipeline-3', { targets: [{ location: target.location, key: 'pipelinekey1' }] }));
        await assert.rejects(collector.testPost(target.location, { probe: true }, 'pipelinekey1'), /non 200 series/);
    }
    finally {
        target.server.close();
    }
});
class PollOnceCollector extends WebJSONCollector {
}
void test('WebJSONCollector polls a JSON source and publishes the payload', async () => {
    const payload = JSON.stringify({ net: 'test net', checkins: 7 });
    const source = https.createServer(tlsOptions, (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(payload);
    });
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    const { port: srcPort } = source.address();
    const target = await startTarget();
    try {
        const collector = new PollOnceCollector({
            plugin: 'webJSON',
            description: 'poll test',
            site: 'test',
            targets: [{ location: target.location, key: 'pipelinekey1' }],
            url: `https://localhost:${srcPort}/data`,
            pollIntervalSec: 3600
        });
        const posted = target.next();
        collector.start();
        const packet = (await posted);
        collector.stop();
        assert.ok(isFfluidityPacket(packet));
        assert.equal(packet.plugin, 'webJSON');
        assert.deepEqual(packet.formattedData, [{ suggestStyle: 0, field: payload, fieldType: 'STRING' }]);
    }
    finally {
        target.server.close();
        source.close();
    }
});
void test('missing or malformed api key: request is never sent (regression: it used to send anyway)', async () => {
    const target = await startTarget();
    try {
        const collector = new MockPortSRSCollector(srsParams('/test/pipeline-4', { targets: [{ location: target.location, key: '' }] }));
        await assert.rejects(collector.testPost(target.location, { probe: true }, ''), /missing API key/);
        await assert.rejects(collector.testPost(target.location, { probe: true }, 'not-alphanumeric!'), /alphanumeric/);
        await sleep(150);
        assert.equal(target.received.length, 0);
    }
    finally {
        target.server.close();
    }
});
class FloodCollector extends DataCollector {
    start() { }
    format(data, fh) {
        return fh.e(data).done;
    }
    flood(lines) {
        for (let i = 0; i < lines; i++)
            this.send(`line ${i}`);
    }
}
void test('a line source that outruns the throttle is shed at the base class, never queued without bound', async () => {
    const target = await startTarget();
    try {
        const collector = new FloodCollector({
            plugin: 'floodTest',
            description: 'line-noise burst',
            site: 'test',
            targets: [{ location: target.location, key: 'floodkey1' }],
            maxHttpsReqPerCollectorPerSec: 50
        });
        collector.flood(500);
        assert.equal(collector.backpressureShed, 400);
        await sleep(2400);
        assert.ok(target.received.length <= 100, `only the admitted lines publish (${target.received.length})`);
        assert.ok(target.received.length >= 90, `the admitted lines DO publish (${target.received.length})`);
    }
    finally {
        target.server.close();
    }
});
void test('the in-flight bound is hard-capped, so a huge throttle cannot balloon memory', async () => {
    const stalled = await startTarget();
    const sockets = [];
    stalled.server.on('connection', s => sockets.push(s));
    try {
        const collector = new FloodCollector({
            plugin: 'floodTest',
            description: 'huge throttle',
            site: 'test',
            targets: [{ location: stalled.location, key: 'floodkey1' }],
            maxHttpsReqPerCollectorPerSec: 100000
        });
        collector.flood(4000);
        assert.equal(collector.backpressureShed, 4000 - 1024);
    }
    finally {
        sockets.forEach(s => s.destroy());
        stalled.server.close();
    }
});
