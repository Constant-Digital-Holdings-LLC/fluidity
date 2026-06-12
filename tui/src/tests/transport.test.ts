import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { Duplex } from 'node:stream';
import { ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { FluidityPacket } from '#@shared/types.js';
import { fetchHistory, follow, shouldVerifyTLS } from '../modules/transport.js';

//dev certs resolved relative to this file's compiled location (tui/dist/tests/),
//not the cwd - the suite happens to run from service/dist/agent, but nothing
//here should depend on that. transport auto-relaxes TLS for loopback hosts,
//which is itself under test here.
const sslDir = new URL('../../../service/dist/server/ssl/', import.meta.url);
const tlsOptions = {
    key: readFileSync(fileURLToPath(new URL('dev-server_key.pem', sslDir))),
    cert: readFileSync(fileURLToPath(new URL('dev-server_cert.pem', sslDir)))
};

const pkt = (seq: number, site = 'tsite'): FluidityPacket => ({
    seq,
    site,
    ts: `2026-06-11T00:00:0${seq % 10}.000Z`,
    description: 'transport test',
    plugin: 'genericSerial',
    formattedData: [{ suggestStyle: 0, field: `payload-${seq}`, fieldType: 'STRING' }]
});

//a minimal fluidity-protocol server: GET /FIFO json array, GET /SSE event stream
interface MiniServer {
    base: URL;
    port: number;
    push(p: FluidityPacket): void;
    close(): Promise<void>;
}

const startMiniServer = async (fifo: FluidityPacket[], port = 0): Promise<MiniServer> => {
    const clients = new Set<ServerResponse>();
    const sockets = new Set<Duplex>();

    const server = https.createServer(tlsOptions, (req, res) => {
        if (req.url === '/FIFO') {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(fifo));
        } else if (req.url === '/SSE') {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write('retry: 5000\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
        } else {
            res.statusCode = 404;
            res.end();
        }
    });

    server.on('connection', s => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
    });

    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const addr = server.address() as AddressInfo;

    return {
        base: new URL(`https://localhost:${addr.port}`),
        port: addr.port,
        push(p: FluidityPacket): void {
            fifo.push(p);
            for (const c of clients) c.write(`id: ${p.seq ?? 0}\ndata: ${JSON.stringify(p)}\n\n`);
        },
        close: () =>
            new Promise<void>(resolve => {
                for (const s of sockets) s.destroy();
                server.close(() => resolve());
            })
    };
};

void test('shouldVerifyTLS: loopback relaxed, remote verified, --insecure overrides', () => {
    assert.equal(shouldVerifyTLS(new URL('https://localhost:3000')), false);
    assert.equal(shouldVerifyTLS(new URL('https://127.0.0.1:3000')), false);
    assert.equal(shouldVerifyTLS(new URL('https://f-y.io')), true);
    assert.equal(shouldVerifyTLS(new URL('https://f-y.io'), true), false);
});

void test('fetchHistory returns validated packets (loopback TLS auto-relaxed)', async () => {
    const srv = await startMiniServer([pkt(1), pkt(2), { junk: true } as unknown as FluidityPacket]);
    try {
        const history = await fetchHistory(srv.base);
        assert.equal(history.length, 2);
        assert.deepEqual(
            history.map(p => p.seq),
            [1, 2]
        );
    } finally {
        await srv.close();
    }
});

void test('follow delivers history then live packets, deduplicating replays', async () => {
    const srv = await startMiniServer([pkt(1)]);
    const received: FluidityPacket[] = [];
    let liveResolve: () => void;
    const liveDone = new Promise<void>(r => (liveResolve = r));

    const handle = follow(
        srv.base,
        { backoffBaseMs: 20 },
        {
            onHistory: ps => received.push(...ps),
            onPacket: p => {
                received.push(p);
                if (received.length >= 2) liveResolve();
            },
            onState: state => {
                if (state === 'live') {
                    srv.push(pkt(2));
                    srv.push(pkt(2)); //identical replay must be dropped
                }
            }
        }
    );

    try {
        await liveDone;
        await sleep(50); //allow any (wrong) duplicate to arrive
        assert.deepEqual(
            received.map(p => p.seq),
            [1, 2]
        );
    } finally {
        handle.stop();
        await srv.close();
    }
});

void test('reconnect after server restart: new packets exactly once, no duplicates', async () => {
    const srv1 = await startMiniServer([pkt(1)]);
    const port = srv1.port;
    const received: FluidityPacket[] = [];
    const states: string[] = [];

    let gotSecond: () => void;
    const secondDone = new Promise<void>(r => (gotSecond = r));

    const handle = follow(
        srv1.base,
        { backoffBaseMs: 20, backoffMaxMs: 100 },
        {
            onHistory: ps => {
                received.push(...ps);
                if (ps.some(p => p.site === 'after-restart')) gotSecond();
            },
            onPacket: p => {
                received.push(p);
                if (p.site === 'after-restart') gotSecond();
            },
            onState: s => states.push(s)
        }
    );

    let srv2: MiniServer | undefined;
    try {
        //wait until live, then kill the server
        while (!states.includes('live')) await sleep(10);
        await srv1.close();

        //fresh server on the same port: seq restarts at 1, ts differs
        srv2 = await startMiniServer([{ ...pkt(1, 'after-restart'), ts: '2026-06-11T09:00:00.000Z' }], port);

        await secondDone;
        await sleep(50);

        const sites = received.map(p => p.site);
        assert.deepEqual(sites.filter(s => s === 'tsite').length, 1, 'original packet once');
        assert.deepEqual(sites.filter(s => s === 'after-restart').length, 1, 'post-restart packet once');
        assert.ok(states.includes('reconnecting'), 'reconnect state surfaced');
    } finally {
        handle.stop();
        await srv2?.close();
    }
});
