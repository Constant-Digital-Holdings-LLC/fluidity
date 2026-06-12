import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeApp } from '../../server/modules/expressApp.js';
import { follow } from '../sseFollow.js';
const sslPath = (f) => fileURLToPath(new URL(`../../server/ssl/${f}`, import.meta.url));
const tls = { key: readFileSync(sslPath('dev-server_key.pem')), cert: readFileSync(sslPath('dev-server_cert.pem')) };
const KEY = 'watchkey1';
const packet = (site, n) => ({
    site,
    plugin: 'p',
    ts: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    description: 'd',
    formattedData: [{ suggestStyle: 0, field: `line ${n}`, fieldType: 'STRING' }],
    rawData: null
});
const startServer = async () => {
    const conf = {
        appName: 'T',
        appVersion: 't',
        logLevel: 'never',
        permittedKeys: [KEY],
        maxServerHistory: 300
    };
    const server = https.createServer(tls, makeApp(conf));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return {
        port: server.address().port,
        drop: () => server.closeAllConnections(),
        close: () => new Promise(res => {
            server.closeAllConnections();
            server.close(() => res());
        })
    };
};
const post = (port, p) => new Promise((resolve, reject) => {
    const body = JSON.stringify(p);
    const req = https.request({
        host: '127.0.0.1',
        port,
        path: '/FIFO',
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': KEY,
            'Content-Length': Buffer.byteLength(body)
        }
    }, res => {
        res.resume();
        res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(`POST ${res.statusCode}`))));
    });
    req.on('error', reject);
    req.end(body);
});
const until = async (cond, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (!cond() && Date.now() < deadline)
        await sleep(20);
    if (!cond())
        throw new Error('condition not met in time');
};
void test('sseFollow reconciles /FIFO then streams live packets (deduped), and reports connection state', async () => {
    const srv = await startServer();
    await post(srv.port, packet('a', 1));
    await post(srv.port, packet('b', 2));
    const reconciled = [];
    const live = [];
    let connected = 0;
    let disconnected = 0;
    const handle = follow(new URL(`https://127.0.0.1:${srv.port}`), { insecure: true }, {
        onReconcile: ps => reconciled.push(ps),
        onPacket: p => live.push(p),
        onConnected: () => connected++,
        onDisconnected: () => disconnected++
    });
    try {
        await until(() => connected > 0 && reconciled.length > 0);
        assert.equal(connected, 1);
        assert.equal(reconciled[0]?.length, 2, '/FIFO snapshot had both prior packets');
        assert.equal(live.length, 0, 'history is not re-emitted as live');
        await post(srv.port, packet('c', 3));
        await until(() => live.length > 0);
        assert.equal(live.length, 1);
        assert.equal(live[0]?.site, 'c', 'the live packet (not a history dupe) is delivered');
    }
    finally {
        handle.stop();
        await srv.close();
    }
});
void test('sseFollow reports disconnect when the server goes away', async () => {
    const srv = await startServer();
    let connected = 0;
    let disconnected = 0;
    const handle = follow(new URL(`https://127.0.0.1:${srv.port}`), { insecure: true, backoffBaseMs: 50, backoffMaxMs: 100 }, {
        onReconcile: () => undefined,
        onPacket: () => undefined,
        onConnected: () => connected++,
        onDisconnected: () => disconnected++
    });
    try {
        await until(() => connected > 0);
        srv.drop();
        await until(() => disconnected > 0);
        assert.ok(disconnected > 0, 'a dropped server surfaces as a disconnect (absence would pause)');
    }
    finally {
        handle.stop();
        await srv.close();
    }
});
