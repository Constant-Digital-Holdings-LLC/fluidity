import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { isFfluidityPacket, FluidityPacket } from '#@shared/types.js';
import { WebJSONCollector } from '../modules/collectors.js';
import { MockPortSRSCollector, srsParams } from './helpers.js';

//tests run with cwd service/dist/agent; the repo dev certs live next door.
//NODE_ENV=development makes the agent skip chain verification, like real dev use.
const tlsOptions = {
    key: readFileSync('../server/ssl/dev-server_key.pem'),
    cert: readFileSync('../server/ssl/dev-server_cert.pem')
};

interface Target {
    server: https.Server;
    location: string;
    received: unknown[];
    next(): Promise<unknown>;
}

const startTarget = async (statusCode = 200): Promise<Target> => {
    const received: unknown[] = [];
    let waiters: ((p: unknown) => void)[] = [];

    const server = https.createServer(tlsOptions, (req, res) => {
        let body = '';
        req.on('data', (c: string) => (body += c));
        req.on('end', () => {
            const parsed: unknown = JSON.parse(body);
            received.push(parsed);
            waiters.forEach(w => w(parsed));
            waiters = [];
            res.statusCode = statusCode;
            res.end();
        });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    return {
        server,
        location: `https://localhost:${port}/FIFO`,
        received,
        next: () => new Promise(resolve => waiters.push(resolve))
    };
};

void test('serial data flows through the collector onto the wire as a FluidityPacket', async () => {
    const target = await startTarget();
    try {
        const collector = new MockPortSRSCollector(
            srsParams('/test/pipeline-1', {
                targets: [{ location: target.location, key: 'pipelinekey1' }],
                extendedOptions: { portmap: ['Repeater440'] }
            })
        );

        const posted = target.next();
        collector.start();
        await once(collector.mockPort, 'open');
        collector.mockPort.port?.emitData('[01 00 00 00 00]\r\n');

        const packet = (await posted) as FluidityPacket;

        assert.ok(isFfluidityPacket(packet), 'posted body must be a valid FluidityPacket');
        assert.equal(packet.site, 'test');
        assert.equal(packet.plugin, 'srsSerial');
        assert.deepEqual(
            packet.formattedData.map(f => f.field),
            ['Radio States: ', 'Repeater440:', 'COR']
        );
    } finally {
        target.server.close();
    }
});

void test('post() resolves on any 2xx response (regression: only 200 was accepted)', async () => {
    const target = await startTarget(201);
    try {
        const collector = new MockPortSRSCollector(
            srsParams('/test/pipeline-2', { targets: [{ location: target.location, key: 'pipelinekey1' }] })
        );

        await assert.doesNotReject(collector.testPost(target.location, { probe: true }, 'pipelinekey1'));
    } finally {
        target.server.close();
    }
});

void test('post() rejects on a 5xx response', async () => {
    const target = await startTarget(500);
    try {
        const collector = new MockPortSRSCollector(
            srsParams('/test/pipeline-3', { targets: [{ location: target.location, key: 'pipelinekey1' }] })
        );

        await assert.rejects(collector.testPost(target.location, { probe: true }, 'pipelinekey1'), /non 200 series/);
    } finally {
        target.server.close();
    }
});

class PollOnceCollector extends WebJSONCollector {}

void test('WebJSONCollector polls a JSON source and publishes the payload', async () => {
    const payload = JSON.stringify({ net: 'test net', checkins: 7 });
    const source = https.createServer(tlsOptions, (req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(payload);
    });
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    const { port: srcPort } = source.address() as AddressInfo;

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

        const packet = (await posted) as FluidityPacket;
        collector.stop();

        assert.ok(isFfluidityPacket(packet));
        assert.equal(packet.plugin, 'webJSON');
        assert.deepEqual(packet.formattedData, [{ suggestStyle: 0, field: payload, fieldType: 'STRING' }]);
    } finally {
        target.server.close();
        source.close();
    }
});

void test('missing or malformed api key: request is never sent (regression: it used to send anyway)', async () => {
    const target = await startTarget();
    try {
        const collector = new MockPortSRSCollector(
            srsParams('/test/pipeline-4', { targets: [{ location: target.location, key: '' }] })
        );

        await assert.rejects(collector.testPost(target.location, { probe: true }, ''), /missing API key/);
        await assert.rejects(collector.testPost(target.location, { probe: true }, 'not-alphanumeric!'), /alphanumeric/);

        //give any stray request time to land before asserting none did
        await sleep(150);
        assert.equal(target.received.length, 0);
    } finally {
        target.server.close();
    }
});
