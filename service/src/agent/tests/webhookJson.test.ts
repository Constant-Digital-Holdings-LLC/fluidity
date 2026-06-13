import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { isFfluidityPacket, FluidityPacket } from '#@shared/types.js';
import WebhookJsonCollector, { WebhookJsonCollectorParams } from '../modules/collectors/webhookJson.js';
import { startTarget } from './helpers.js';

//a Kuma-shaped mapping: status code -> "[Pn]" routing prefix (+ style), then
//the human message - the exact use case the collector was built for
const kumaRoute = {
    path: '/kuma',
    site: 'kuma',
    plugin: 'notify',
    descriptionFrom: 'monitor.name',
    description: 'Uptime Kuma',
    fields: [
        {
            from: 'heartbeat.status',
            map: { '0': '[P5]', '1': '[P4]' },
            default: '[P3]',
            styleMap: { '0': 2, '1': 3 }
        },
        { from: 'msg' }
    ]
};

const whParams = (over: Partial<WebhookJsonCollectorParams> = {}): WebhookJsonCollectorParams => ({
    plugin: 'webhookJson',
    description: 'webhook gateway under test',
    site: 'agent-site',
    targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
    port: 0, //ephemeral; read back via ready()
    bind: '127.0.0.1',
    extendedOptions: { routes: [kumaRoute] },
    ...over
});

//collector listening on an ephemeral port + a tiny POST helper aimed at it
const liveCollector = async (
    over: Partial<WebhookJsonCollectorParams> = {}
): Promise<{
    collector: WebhookJsonCollector;
    port: number;
    post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Response>;
    close: () => void;
}> => {
    const collector = new WebhookJsonCollector(whParams(over));
    collector.start();
    const port = await collector.ready();

    return {
        collector,
        port,
        post: (path, body, headers = {}) =>
            fetch(`http://127.0.0.1:${port}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: typeof body === 'string' ? body : JSON.stringify(body)
            }),
        close: () => collector.stop()
    };
};

const kumaDown = {
    heartbeat: { status: 0, msg: 'connect ECONNREFUSED' },
    monitor: { name: 'Plex' },
    msg: '[Plex] [Down] connect ECONNREFUSED'
};

void test('webhookJson maps a Kuma DOWN webhook into a routed FluidityPacket end to end', async () => {
    const target = await startTarget();
    const { post, close } = await liveCollector({ targets: [{ location: target.location, key: 'testkey1' }] });
    try {
        const next = target.next();
        const res = await post('/kuma', kumaDown);
        assert.equal(res.status, 200);

        const packet = (await next) as FluidityPacket;
        assert.ok(isFfluidityPacket(packet), 'gateway must emit an exact FluidityPacket');
        //route identity overrides win (udpStruct-style per-packet identity)
        assert.equal(packet.site, 'kuma');
        assert.equal(packet.plugin, 'notify');
        assert.equal(packet.description, 'Plex');
        //status 0 -> the mapped prefix with its mapped style, then the message
        assert.deepEqual(
            packet.formattedData.map(f => f.field),
            ['[P5]', '[Plex] [Down] connect ECONNREFUSED']
        );
        assert.equal(packet.formattedData[0]?.suggestStyle, 2);
        assert.equal(packet.formattedData[1]?.suggestStyle, 0);
    } finally {
        close();
        target.server.close();
    }
});

void test('webhookJson value mapping: UP, unmapped status, and an absent path take map/default/omit', async () => {
    const target = await startTarget();
    const { post, close } = await liveCollector({ targets: [{ location: target.location, key: 'testkey1' }] });
    try {
        let next = target.next();
        await post('/kuma', { heartbeat: { status: 1 }, monitor: { name: 'Plex' }, msg: 'up again' });
        let p = (await next) as FluidityPacket;
        assert.deepEqual(
            p.formattedData.map(f => [f.field, f.suggestStyle]),
            [
                ['[P4]', 3],
                ['up again', 0]
            ]
        );

        //status 2 (pending) misses the map -> the default catches it
        next = target.next();
        await post('/kuma', { heartbeat: { status: 2 }, msg: 'pending' });
        p = (await next) as FluidityPacket;
        assert.equal(p.formattedData[0]?.field, '[P3]');
        assert.equal(p.formattedData[0]?.suggestStyle, 0); //styleMap miss -> static style
        //descriptionFrom absent -> the static route description
        assert.equal(p.description, 'Uptime Kuma');

        //Kuma's notification Test button: heartbeat null -> default prefix,
        //msg still rides; the absent monitor name falls back
        next = target.next();
        await post('/kuma', { heartbeat: null, monitor: null, msg: 'Testing' });
        p = (await next) as FluidityPacket;
        assert.deepEqual(
            p.formattedData.map(f => f.field),
            ['[P3]', 'Testing']
        );
    } finally {
        close();
        target.server.close();
    }
});

void test('webhookJson: absent value with no default omits the field; all-absent answers ok-empty and posts nothing', async () => {
    const target = await startTarget();
    const { post, close } = await liveCollector({
        targets: [{ location: target.location, key: 'testkey1' }]
    });
    try {
        //msg absent (no default on that field) -> only the prefix field rides
        const next = target.next();
        await post('/kuma', { heartbeat: { status: 0 } });
        const p = (await next) as FluidityPacket;
        assert.deepEqual(
            p.formattedData.map(f => f.field),
            ['[P5]']
        );

        //a payload yielding zero fields is accepted (no sender retry storm)
        //but counted - a source whose shape changed shows up in dropCounts.
        //This route has a default on the status field, so build one without:
        const bare = await liveCollector({
            targets: [{ location: target.location, key: 'testkey1' }],
            extendedOptions: { routes: [{ path: '/x', fields: [{ from: 'nope.nothing' }] }] }
        });
        try {
            const posted = target.received.length;
            const res = await bare.post('/x', { unrelated: true });
            assert.equal(res.status, 200);
            assert.equal(await res.text(), 'ok (empty)');
            assert.equal(bare.collector.dropCounts.get('empty-mapping'), 1);
            await sleep(50);
            assert.equal(target.received.length, posted, 'nothing published upstream');
        } finally {
            bare.close();
        }
    } finally {
        close();
        target.server.close();
    }
});

void test('webhookJson extraction: const fields, object dumps, and array index paths', async () => {
    const target = await startTarget();
    const { post, close } = await liveCollector({
        targets: [{ location: target.location, key: 'testkey1' }],
        extendedOptions: {
            routes: [
                {
                    path: '/shapes',
                    fields: [
                        { const: 'static-lead', suggestStyle: 6 },
                        { from: 'nested.obj' },
                        { from: 'items.1.name' },
                        { from: 'flag' }
                    ]
                }
            ]
        }
    });
    try {
        const next = target.next();
        await post('/shapes', {
            nested: { obj: { a: 1 } },
            items: [{ name: 'zero' }, { name: 'one' }],
            flag: false
        });
        const p = (await next) as FluidityPacket;
        assert.deepEqual(
            p.formattedData.map(f => f.field),
            ['static-lead', '{"a":1}', 'one', 'false']
        );
        assert.equal(p.formattedData[0]?.suggestStyle, 6);
        //no route site/plugin overrides -> the collector identity rides
        assert.equal(p.site, 'agent-site');
        assert.equal(p.plugin, 'webhookJson');
        assert.equal(p.description, 'webhook gateway under test');
    } finally {
        close();
        target.server.close();
    }
});

void test('webhookJson HTTP surface: health probe, unknown route, wrong method, bad JSON, oversize', async () => {
    const { collector, port, post, close } = await liveCollector();
    try {
        const health = await fetch(`http://127.0.0.1:${port}/health`);
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { ok: true });

        assert.equal((await post('/nope', {})).status, 404);
        assert.equal(collector.dropCounts.get('no-route'), 1);

        const get = await fetch(`http://127.0.0.1:${port}/kuma`);
        assert.equal(get.status, 405);
        assert.equal(get.headers.get('allow'), 'POST');
        assert.equal(collector.dropCounts.get('bad-method'), 1);

        assert.equal((await post('/kuma', '{not json')).status, 400);
        assert.equal(collector.dropCounts.get('bad-json'), 1);

        const big = await post('/kuma', `"${'x'.repeat(300 * 1024)}"`);
        assert.equal(big.status, 413);
        assert.equal(collector.dropCounts.get('oversize'), 1);
    } finally {
        close();
    }
});

void test('webhookJson token mode: missing/wrong tokens 401, Bearer and x-webhook-token both accepted', async () => {
    const target = await startTarget();
    const { collector, post, close } = await liveCollector({
        targets: [{ location: target.location, key: 'testkey1' }],
        extendedOptions: { token: 'hunter2', routes: [kumaRoute] }
    });
    try {
        assert.equal((await post('/kuma', kumaDown)).status, 401);
        assert.equal((await post('/kuma', kumaDown, { Authorization: 'Bearer wrong' })).status, 401);
        assert.equal(collector.dropCounts.get('unauthorized'), 2);

        const next = target.next();
        assert.equal((await post('/kuma', kumaDown, { Authorization: 'Bearer hunter2' })).status, 200);
        await next;
        assert.equal((await post('/kuma', kumaDown, { 'x-webhook-token': 'hunter2' })).status, 200);
    } finally {
        close();
        target.server.close();
    }
});

void test('webhookJson defaults to a gateway upstream rate; an explicit throttle is honored', () => {
    const dflt = new WebhookJsonCollector(whParams());
    assert.equal(dflt.maxPostsPerSec, 50);
    dflt.stop();

    const custom = new WebhookJsonCollector(whParams({ maxHttpsReqPerCollectorPerSec: 7 }));
    assert.equal(custom.maxPostsPerSec, 7);
    custom.stop();
});

void test('webhookJson misconfiguration throws at startup (degrade loudly, never run weakened)', () => {
    //a missing port refuses to start (no canonical webhook port to assume)
    const { port: _p, ...noPort } = whParams();
    void _p;
    assert.throws(() => new WebhookJsonCollector(noPort), /port must be an integer/);

    const routes = (r: unknown[]): object => ({ routes: r });
    const cases: [Partial<WebhookJsonCollectorParams>, RegExp][] = [
        [{ port: 70000 }, /port must be an integer/],
        [{ bind: 9 as unknown as string }, /bind must be an interface address/],
        [{ extendedOptions: {} }, /routes must be a non-empty array/],
        [{ extendedOptions: routes([]) }, /routes must be a non-empty array/],
        [{ extendedOptions: routes([{ path: 'kuma', fields: [{ const: 'x' }] }]) }, /path must be a string starting/],
        [{ extendedOptions: routes([{ path: '/health', fields: [{ const: 'x' }] }]) }, /reserved for the liveness/],
        [
            {
                extendedOptions: routes([
                    { path: '/a', fields: [{ const: 'x' }] },
                    { path: '/a', fields: [{ const: 'x' }] }
                ])
            },
            /duplicate route/
        ],
        [{ extendedOptions: routes([{ path: '/a', site: '', fields: [{ const: 'x' }] }]) }, /site must be a non-empty/],
        [
            { extendedOptions: routes([{ path: '/a', plugin: '', fields: [{ const: 'x' }] }]) },
            /plugin must be a non-empty/
        ],
        [{ extendedOptions: routes([{ path: '/a', fields: [] }]) }, /fields must be a non-empty array/],
        [{ extendedOptions: routes([{ path: '/a', fields: [{}] }]) }, /exactly one of "from"/],
        [{ extendedOptions: routes([{ path: '/a', fields: [{ from: 'x', const: 'y' }] }]) }, /exactly one of "from"/],
        [{ extendedOptions: routes([{ path: '/a', fields: [{ const: 'y', map: {} }] }]) }, /only applies with "from"/],
        [{ extendedOptions: routes([{ path: '/a', fields: [{ from: 'a..b' }] }]) }, /empty path segment/],
        [{ extendedOptions: routes([{ path: '/a', fields: [{ from: 'x', map: { a: 1 } }] }]) }, /must be a string/],
        [
            { extendedOptions: routes([{ path: '/a', fields: [{ from: 'x', styleMap: { a: 'red' } }] }]) },
            /styleMap\["a"\] must be a non-negative integer/
        ],
        [{ extendedOptions: routes([{ path: '/a', fields: [{ from: 'x', suggestStyle: -1 }] }]) }, /suggestStyle/],
        [{ extendedOptions: routes([{ path: '/a', descriptionFrom: '', fields: [{ const: 'x' }] }]) }, /dot-path/],
        [{ extendedOptions: { token: '', routes: [kumaRoute] } }, /token must be a non-empty string/]
    ];
    for (const [over, re] of cases) {
        assert.throws(() => new WebhookJsonCollector(whParams(over)), re, `expected throw for ${JSON.stringify(over)}`);
    }
});

void test('webhookJson loads through the dynamic plugin registry like any collector', async () => {
    const { buildCollectors } = await import('../modules/runner.js');
    const collectors = await buildCollectors({
        appName: 'Fluidity',
        appVersion: 'test',
        site: 'agent-site',
        targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
        collectors: [
            {
                description: 'gateway via registry',
                plugin: 'webhookJson',
                port: 0,
                bind: '127.0.0.1',
                extendedOptions: { routes: [kumaRoute] }
            }
        ]
    } as never);
    //the configured gateway + the always-on internal vRep heartbeat
    assert.equal(collectors.length, 2);
    assert.ok(collectors[0] instanceof WebhookJsonCollector);
    for (const c of collectors) c.stop();
});
