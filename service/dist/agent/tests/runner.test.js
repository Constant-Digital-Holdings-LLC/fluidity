import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectors } from '../modules/runner.js';
import { DataCollector } from '../modules/collectors.js';
const conf = (over = {}) => ({
    appName: 'Fluidity',
    appVersion: 'test',
    site: 'test-site',
    targets: [{ location: 'https://localhost:1/FIFO', key: 'testkey1' }],
    collectors: [{ description: 'sim SRS', plugin: 'srsSerial', path: 'sim://srs', baudRate: 9600 }],
    ...over
});
void test('a valid config yields constructed collectors', async () => {
    const built = await buildCollectors(conf({
        collectors: [
            { description: 'sim SRS', plugin: 'srsSerial', path: 'sim://srs', baudRate: 9600 },
            { description: 'version', plugin: 'vRep', pollIntervalSec: 3600 }
        ]
    }));
    assert.equal(built.length, 2);
    built.forEach(c => assert.ok(c instanceof DataCollector));
    assert.deepEqual(built.map(c => c.params.plugin), ['srsSerial', 'vRep']);
    built.forEach(c => c.stop());
});
void test('missing site name is rejected', async () => {
    await assert.rejects(buildCollectors(conf({ site: undefined })), /site name/);
});
void test('missing targets are rejected', async () => {
    await assert.rejects(buildCollectors(conf({ targets: undefined })), /no targets/);
});
void test('non-HTTPS targets are rejected', async () => {
    await assert.rejects(buildCollectors(conf({ targets: [{ location: 'http://localhost:1/FIFO', key: 'k1' }] })), /HTTPS/);
});
void test('a target without a key is rejected', async () => {
    await assert.rejects(buildCollectors(conf({ targets: [{ location: 'https://localhost:1/FIFO', key: '' }] })), /HTTPS/);
});
void test('an empty collector list is rejected', async () => {
    await assert.rejects(buildCollectors(conf({ collectors: [] })), /no data collectors/);
    await assert.rejects(buildCollectors(conf({ collectors: undefined })), /no data collectors/);
});
void test('collector stanzas missing required fields are rejected', async () => {
    await assert.rejects(buildCollectors(conf({ collectors: [{ plugin: 'srsSerial', path: 'sim://srs', baudRate: 9600 }] })), /Invalid plugin params/);
});
void test('an unknown plugin name fails with a module resolution error', async () => {
    await assert.rejects(buildCollectors(conf({ collectors: [{ description: 'oops', plugin: 'noSuchPlugin', path: 'sim://srs', baudRate: 9600 }] })), /Cannot find module|not found/i);
});
