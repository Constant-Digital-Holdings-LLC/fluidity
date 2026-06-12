import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectors } from '../modules/runner.js';
import { MyConfigData } from '#@shared/modules/fluidityConfig.js';
import { DataCollector } from '../modules/collectors.js';

const conf = (over: Record<string, unknown> = {}): MyConfigData =>
    ({
        appName: 'Fluidity',
        appVersion: 'test',
        site: 'test-site',
        targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
        collectors: [{ description: 'sim SRS', plugin: 'srsSerial', path: 'sim://srs', baudRate: 9600 }],
        ...over
    }) as unknown as MyConfigData;

void test('a valid config yields constructed collectors', async () => {
    const built = await buildCollectors(
        conf({
            collectors: [
                { description: 'sim SRS', plugin: 'srsSerial', path: 'sim://srs', baudRate: 9600 },
                { description: 'version', plugin: 'vRep', pollIntervalSec: 3600 }
            ]
        })
    );

    assert.equal(built.length, 2);
    built.forEach(c => assert.ok(c instanceof DataCollector));
    assert.deepEqual(
        built.map(c => c.params.plugin),
        ['srsSerial', 'vRep']
    );

    //the sim feeder holds a timer; release handles so the test process can exit
    built.forEach(c => c.stop());
});

void test('a collector with "enabled": false is kept in config but not loaded', async () => {
    const built = await buildCollectors(
        conf({
            collectors: [
                { description: 'version', plugin: 'vRep', pollIntervalSec: 3600 },
                {
                    description: 'Net Watcher',
                    plugin: 'hamLive',
                    enabled: false,
                    url: 'https://x/y',
                    pollIntervalSec: 60
                },
                { description: 'sim SRS', plugin: 'srsSerial', path: 'sim://srs', baudRate: 9600 }
            ]
        })
    );

    assert.deepEqual(
        built.map(c => c.params.plugin),
        ['vRep', 'srsSerial'],
        'the disabled hamLive stanza is skipped, the rest load in order'
    );

    //enabled:true and a missing flag both load (disabling is opt-in)
    const onByDefault = await buildCollectors(
        conf({
            collectors: [
                { description: 'a', plugin: 'vRep', pollIntervalSec: 3600, enabled: true },
                { description: 'b', plugin: 'vRep', pollIntervalSec: 3600 }
            ]
        })
    );
    assert.equal(onByDefault.length, 2, 'enabled:true and absent both load');

    built.forEach(c => c.stop());
    onByDefault.forEach(c => c.stop());
});

void test('a non-boolean "enabled" warns and the collector still loads', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]): void => void warnings.push(a.join(' '));
    let built: DataCollector[] = [];
    try {
        //"false" looks like a disable but is a string; only the bare boolean
        //disables, so this collector loads - and that must be surfaced
        built = await buildCollectors(
            conf({
                collectors: [
                    { description: 'oops-quoted', plugin: 'vRep', pollIntervalSec: 3600, enabled: 'false' },
                    { description: 'real-off', plugin: 'vRep', pollIntervalSec: 3600, enabled: false }
                ]
            })
        );
    } finally {
        console.warn = origWarn;
    }

    //the quoted-false stanza still loaded; the bare-false one was skipped
    assert.deepEqual(
        built.map(c => c.params.description),
        ['oops-quoted'],
        'quoted "false" loads, bare false is skipped'
    );
    assert.ok(
        warnings.some(w => /oops-quoted/.test(w) && /non-boolean "enabled"/.test(w) && /will LOAD/.test(w)),
        `expected a non-boolean enabled warning, got: ${JSON.stringify(warnings)}`
    );
    //a real boolean false must NOT warn
    assert.ok(!warnings.some(w => /real-off/.test(w)), 'a bare boolean false does not warn');

    built.forEach(c => c.stop());
});

void test('missing site name is rejected', async () => {
    await assert.rejects(buildCollectors(conf({ site: undefined })), /site name/);
});

void test('missing targets are rejected', async () => {
    await assert.rejects(buildCollectors(conf({ targets: undefined })), /no targets/);
});

void test('non-HTTPS targets are rejected', async () => {
    await assert.rejects(
        buildCollectors(conf({ targets: [{ location: 'http://localhost:1/FIFO', key: 'k1' }] })),
        /HTTPS/
    );
});

void test('a target without a key is rejected', async () => {
    await assert.rejects(
        buildCollectors(conf({ targets: [{ location: 'https://localhost:1/FIFO', key: '' }] })),
        /HTTPS/
    );
});

void test('an empty collector list is rejected', async () => {
    await assert.rejects(buildCollectors(conf({ collectors: [] })), /no data collectors/);
    await assert.rejects(buildCollectors(conf({ collectors: undefined })), /no data collectors/);
});

void test('collector stanzas missing required fields are rejected', async () => {
    await assert.rejects(
        buildCollectors(conf({ collectors: [{ plugin: 'srsSerial', path: 'sim://srs', baudRate: 9600 }] })),
        /Invalid plugin params/
    );
});

void test('an unknown plugin name fails with a module resolution error', async () => {
    await assert.rejects(
        buildCollectors(
            conf({ collectors: [{ description: 'oops', plugin: 'noSuchPlugin', path: 'sim://srs', baudRate: 9600 }] })
        ),
        /Cannot find module|not found/i
    );
});
