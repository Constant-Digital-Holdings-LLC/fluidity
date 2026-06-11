import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FormatHelper, WebJSONCollectorParams } from '../modules/collectors.js';
import HamLiveCollector from '../modules/collectors/hamLive.js';
import { isFluidityLink } from '#@shared/types.js';

const params = (notifyIntervalSec = 900): WebJSONCollectorParams & { notifyIntervalSec: number } => ({
    plugin: 'hamLive',
    description: 'ham.live test',
    site: 'test',
    targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey' }],
    url: 'https://localhost:1/api/data/livenets',
    pollIntervalSec: 3600,
    notifyIntervalSec
});

const net = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: `net-${JSON.stringify(over)}`,
    title: 'Test Net',
    frequency: '146.520',
    mode: 'FM',
    permanent: false,
    modeDetails: '',
    countdownTimer: 0,
    started: true,
    url: '/views/livenet/abc123',
    createdAt: '2026-06-11T00:00:00.000Z',
    ...over
});

void test('an in-progress net renders as a link plus status text', () => {
    const c = new HamLiveCollector(params());
    const out = c.format(JSON.stringify({ netlist: [net({ id: 'n-progress' })] }), new FormatHelper());

    assert.ok(out);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.fieldType, 'LINK');
    assert.ok(isFluidityLink(out[0]?.field));
    assert.equal(out[0]?.field.name, 'Test Net');
    assert.equal(out[0]?.field.location, 'https://ham.live/views/livenet/abc123');
    assert.deepEqual(out[1], { suggestStyle: 0, field: '  in progress', fieldType: 'STRING' });
});

void test('an upcoming net includes its computed start time', () => {
    const c = new HamLiveCollector(params());
    const out = c.format(
        JSON.stringify({
            netlist: [
                net({
                    id: 'n-upcoming',
                    started: false,
                    createdAt: '2026-06-11T00:00:00.000Z',
                    countdownTimer: 30
                })
            ]
        }),
        new FormatHelper()
    );

    assert.ok(out);
    assert.equal(out[1]?.field, '  starts at ');
    //createdAt + countdownTimer minutes
    assert.deepEqual(out[2], { suggestStyle: 3, field: '2026-06-11T00:30:00.000Z', fieldType: 'DATE' });
});

void test('permanent nets are filtered out and repeat notifications are throttled', () => {
    const c = new HamLiveCollector(params(900));

    const permanentOnly = c.format(
        JSON.stringify({ netlist: [net({ id: 'n-perm', permanent: true })] }),
        new FormatHelper()
    );
    assert.deepEqual(permanentOnly, []);

    const first = c.format(JSON.stringify({ netlist: [net({ id: 'n-throttle' })] }), new FormatHelper());
    assert.ok(first && first.length > 0);

    //same net again within notifyIntervalSec: suppressed
    const second = c.format(JSON.stringify({ netlist: [net({ id: 'n-throttle' })] }), new FormatHelper());
    assert.deepEqual(second, []);
});

void test('unrecognized shapes yield empty output and bad JSON throws', () => {
    const c = new HamLiveCollector(params());

    assert.deepEqual(c.format(JSON.stringify({ unrelated: true }), new FormatHelper()), []);
    assert.deepEqual(c.format(JSON.stringify({ netlist: [{ junk: 1 }] }), new FormatHelper()), []);
    //a malformed body throws; the polling path catches and logs it
    assert.throws(() => c.format('not json at all', new FormatHelper()));
});

void test('a real captured ham.live response parses without error', () => {
    const fixturePath = fileURLToPath(
        new URL('../../../../sims/fixtures/ham-live-livenets-2026-06-11.json', import.meta.url)
    );
    const body = readFileSync(fixturePath, 'utf8');

    const c = new HamLiveCollector(params(0));
    const out = c.format(body, new FormatHelper());

    assert.ok(Array.isArray(out));
    //every emitted link must point at ham.live
    out.forEach(f => {
        if (f.fieldType === 'LINK' && isFluidityLink(f.field)) {
            assert.match(f.field.location, /^https:\/\/ham\.live\//);
        }
    });
});

void test('vRep-style polling collectors report through send (smoke via PollingCollector)', async () => {
    const { default: VersionCollector } = await import('../modules/collectors/vRep.js');

    class CapturingVRep extends VersionCollector {
        public sent: string[] = [];
        protected override send(data: string): void {
            this.sent.push(data);
        }
    }

    const c = new CapturingVRep({
        plugin: 'vRep',
        description: 'version test',
        site: 'test',
        targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey' }],
        pollIntervalSec: 3600
    });

    c.execPerInterval();
    assert.equal(c.sent.length, 1);
    assert.match(c.sent[0] ?? '', /^Fluidity Agent /);
});
