import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { makeApp } from '../modules/expressApp.js';
import { MyConfigData } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket } from '#@shared/types.js';

//Adversarial: the server's standing invariants are (1) it NEVER relays or
//retains a body that fails the shared type-guard, (2) a rejected POST (bad
//body or bad key) must not advance the seq counter or leak into the FIFO/SSE,
//and (3) seq is gap-free + strictly monotonic and the SSE id mirrors it - even
//under concurrent posts. These attack all three.

const API_KEY = 'adversarialkey1';
const conf: MyConfigData = {
    appName: 'Fluidity',
    appVersion: 'test',
    logLevel: 'never',
    permittedKeys: [API_KEY],
    maxServerHistory: 100
};

const valid = (over: Partial<FluidityPacket> = {}): FluidityPacket => ({
    site: 'site',
    ts: '2026-06-11T00:00:00.000Z',
    description: 'd',
    plugin: 'p',
    formattedData: [{ suggestStyle: 0, field: 'hello', fieldType: 'STRING' }],
    ...over
});

const startServer = async (): Promise<{ base: string; close: () => void }> => {
    const server = http.createServer(makeApp(conf));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
};

const post = (base: string, body: unknown, key: string | null = API_KEY): Promise<Response> =>
    fetch(`${base}/FIFO`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(key === null ? {} : { 'x-api-key': key })
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000)
    });

const fifo = async (base: string): Promise<FluidityPacket[]> =>
    (await (await fetch(`${base}/FIFO`, { signal: AbortSignal.timeout(3000) })).json()) as FluidityPacket[];

void test('a rejected POST advances neither seq nor the FIFO (no burned numbers, no leak)', async () => {
    const { base, close } = await startServer();
    try {
        assert.equal((await post(base, valid({ site: 'first' }))).status, 200);

        //a barrage of rejects between two good posts
        assert.equal((await post(base, { not: 'a packet' })).status, 400);
        assert.equal((await post(base, valid(), 'wrongkey')).status, 401);
        assert.equal((await post(base, null)).status, 400);
        assert.equal((await post(base, valid(), null)).status, 401);

        assert.equal((await post(base, valid({ site: 'second' }))).status, 200);

        const arr = await fifo(base);
        assert.equal(arr.length, 2, 'only the two valid packets are retained');
        assert.deepEqual(
            arr.map(p => p.site),
            ['first', 'second']
        );
        //seq is gap-free: the rejects in between did NOT consume a number
        assert.deepEqual(
            arr.map(p => p.seq),
            [1, 2],
            'rejected POSTs never advanced the seq counter'
        );
    } finally {
        close();
    }
});

void test('the server never relays a body that fails the shared guard', async () => {
    const { base, close } = await startServer();
    try {
        const hostile: unknown[] = [
            null,
            [],
            {},
            { site: 's' }, //missing required fields
            valid({ site: '' }), //empty site
            valid({ ts: 'not-a-date' }),
            { ...valid(), ts: 'not-a-date' },
            { ...valid(), formattedData: 'nope' },
            { ...valid(), formattedData: [{ suggestStyle: 0, field: 'x', fieldType: 'BOGUS' }] },
            {
                ...valid(),
                formattedData: [
                    { suggestStyle: 0, fieldType: 'LINK', field: { name: 'n', location: 'javascript:alert(1)' } }
                ]
            },
            { ...valid(), rawData: 123 }
        ];
        for (const body of hostile) {
            const res = await post(base, body);
            assert.equal(res.status, 400, `hostile body should 400: ${JSON.stringify(body)}`);
        }
        const arr = await fifo(base);
        assert.equal(arr.length, 0, 'no hostile body was retained or relayed');
    } finally {
        close();
    }
});

void test('empty / whitespace / symbol API keys are all rejected', async () => {
    const { base, close } = await startServer();
    try {
        //note: HTTP strips a header value's surrounding whitespace (RFC 7230
        //OWS), so "<key> " would arrive as the real key - that's transport, not
        //an auth bypass, so it's not an adversarial case. These are.
        for (const key of ['', '   ', 'key@123!', 'WRONG', 'adversarialkey']) {
            assert.equal((await post(base, valid(), key)).status, 401, `key ${JSON.stringify(key)} must 401`);
        }
        assert.equal((await fifo(base)).length, 0);
    } finally {
        close();
    }
});

void test('seq is gap-free and monotonic across many sequential posts', async () => {
    const { base, close } = await startServer();
    try {
        const N = 30;
        for (let i = 0; i < N; i++) assert.equal((await post(base, valid({ site: `s${i}` }))).status, 200);
        const arr = await fifo(base);
        assert.deepEqual(
            arr.map(p => p.seq),
            Array.from({ length: N }, (_, i) => i + 1)
        );
    } finally {
        close();
    }
});

void test('concurrent posts produce a unique, gap-free seq set (no double-assignment)', async () => {
    const { base, close } = await startServer();
    try {
        const N = 25;
        const results = await Promise.all(Array.from({ length: N }, (_, i) => post(base, valid({ site: `c${i}` }))));
        for (const r of results) assert.equal(r.status, 200);
        const seqs = (await fifo(base)).map(p => p.seq).sort((a, b) => (a ?? 0) - (b ?? 0));
        assert.deepEqual(
            seqs,
            Array.from({ length: N }, (_, i) => i + 1),
            'every concurrent post got a distinct seq, 1..N with no gaps or repeats'
        );
    } finally {
        close();
    }
});

void test('the live SSE id equals the broadcast packet seq', async () => {
    const { base, close } = await startServer();
    try {
        //seed one so the next live packet is seq 2 (a non-trivial id)
        await post(base, valid({ site: 'seed' }));

        const sse = await fetch(`${base}/SSE`, {
            headers: { accept: 'text/event-stream' },
            signal: AbortSignal.timeout(5000)
        });
        assert.ok(sse.body);
        const reader = sse.body.getReader();
        const decoder = new TextDecoder();

        await post(base, valid({ site: 'live' }));

        let buf = '';
        const hasBlock = (b: string): boolean => b.includes('id:') && b.includes('data:') && b.includes('\n\n');
        while (!hasBlock(buf)) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value);
        }
        await reader.cancel();

        const idLine = buf.split('\n').find(l => l.startsWith('id:'));
        const dataLine = buf.split('\n').find(l => l.startsWith('data:'));
        assert.ok(idLine && dataLine, 'SSE block carried both an id and data');
        const id = Number(idLine.slice(3).trim());
        const packet = JSON.parse(dataLine.slice(5).trim()) as FluidityPacket;
        assert.equal(packet.site, 'live');
        assert.equal(id, packet.seq, 'the SSE id mirrors the packet seq exactly');
        assert.equal(id, 2, 'seq advanced past the seed');
    } finally {
        close();
    }
});
