import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { makeApp } from '../modules/expressApp.js';
import { MyConfigData } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket } from '#@shared/types.js';

//minimal typings for Node's runtime fetch - untyped in @types/node 18, drop with phase 3
interface FetchResponse {
    status: number;
    headers: { get(name: string): string | null };
    body: {
        getReader(): {
            read(): Promise<{ value?: Uint8Array; done: boolean }>;
            cancel(): Promise<void>;
        };
    } | null;
    json(): Promise<unknown>;
    text(): Promise<string>;
}

declare const fetch: (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown }
) => Promise<FetchResponse>;

const API_KEY = 'testkey123';

const testConf: MyConfigData = {
    appName: 'Fluidity',
    appVersion: 'test',
    logLevel: 'never',
    permittedKeys: [API_KEY],
    maxServerHistory: 5
};

const packet = (site = 'testsite'): FluidityPacket => ({
    site,
    ts: '2026-06-11T00:00:00.000Z',
    description: 'integration test device',
    plugin: 'genericSerial',
    formattedData: [{ suggestStyle: 0, field: 'hello', fieldType: 'STRING' }]
});

//the production entry wraps the same app in TLS; plain http keeps tests cert-free
const startServer = async (): Promise<{ server: http.Server; base: string }> => {
    const server = http.createServer(makeApp(testConf));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    return { server, base: `http://127.0.0.1:${port}` };
};

const postPacket = (base: string, body: unknown, key = API_KEY): Promise<FetchResponse> =>
    fetch(`${base}/FIFO`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000)
    });

void test('FIFO lifecycle: starts empty, accepts keyed posts, serves history with seq', async () => {
    const { server, base } = await startServer();
    try {
        let res = await fetch(`${base}/FIFO`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), []);

        res = await postPacket(base, packet());
        assert.equal(res.status, 200);

        res = await fetch(`${base}/FIFO`);
        const arr = (await res.json()) as FluidityPacket[];
        assert.equal(arr.length, 1);
        assert.equal(arr[0]?.site, 'testsite');
        assert.equal(arr[0]?.seq, 1);
    } finally {
        server.close();
    }
});

void test('POST /FIFO rejects missing or wrong api key with 401', async () => {
    const { server, base } = await startServer();
    try {
        const wrongKey = await postPacket(base, packet(), 'wrongkey1');
        assert.equal(wrongKey.status, 401);

        const noKey = await fetch(`${base}/FIFO`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(packet()),
            signal: AbortSignal.timeout(3000)
        });
        assert.equal(noKey.status, 401);

        const res = await fetch(`${base}/FIFO`);
        assert.deepEqual(await res.json(), []);
    } finally {
        server.close();
    }
});

void test('POST /FIFO responds 400 to a non-packet body (regression: used to hang)', async () => {
    const { server, base } = await startServer();
    try {
        const res = await postPacket(base, { not: 'a packet' });
        assert.equal(res.status, 400);

        const empty = await postPacket(base, {});
        assert.equal(empty.status, 400);
    } finally {
        server.close();
    }
});

void test('FIFO evicts oldest packets beyond maxServerHistory', async () => {
    const { server, base } = await startServer();
    try {
        for (let i = 1; i <= 7; i++) {
            await postPacket(base, packet(`site-${i}`));
        }

        const res = await fetch(`${base}/FIFO`);
        const arr = (await res.json()) as FluidityPacket[];
        assert.equal(arr.length, 5);
        assert.deepEqual(
            arr.map(p => p.site),
            ['site-3', 'site-4', 'site-5', 'site-6', 'site-7']
        );
    } finally {
        server.close();
    }
});

void test('SSE delivers a posted packet to a subscribed client', async () => {
    const { server, base } = await startServer();
    try {
        const sse = await fetch(`${base}/SSE`, {
            headers: { accept: 'text/event-stream' },
            signal: AbortSignal.timeout(5000)
        });
        assert.ok(sse.headers.get('content-type')?.includes('text/event-stream'));
        assert.ok(sse.body);

        await postPacket(base, packet('sse-site'));

        const reader = sse.body.getReader();
        const decoder = new TextDecoder();
        //the stream opens with a "retry: 5000" handshake; wait for a complete data event
        const hasEvent = (b: string): boolean => {
            const i = b.indexOf('data:');
            return i !== -1 && b.indexOf('\n\n', i) !== -1;
        };
        let buf = '';
        while (!hasEvent(buf)) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value);
        }
        await reader.cancel();

        const dataLine = buf.split('\n').find(l => l.startsWith('data:'));
        assert.ok(dataLine, `no data line in SSE stream: ${buf}`);
        const delivered = JSON.parse(dataLine.slice(5)) as FluidityPacket;
        assert.equal(delivered.site, 'sse-site');
    } finally {
        server.close();
    }
});

void test('dashboard and about pages render', async () => {
    const { server, base } = await startServer();
    try {
        for (const path of ['/', '/about']) {
            const res = await fetch(`${base}${path}`);
            assert.equal(res.status, 200, `${path} should render`);
            assert.match(await res.text(), /<html/i);
        }
    } finally {
        server.close();
    }
});
