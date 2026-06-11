import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FormatHelper } from '../modules/collectors.js';
import { CapturingSRSCollector, srsParams } from './helpers.js';
const fixturePath = fileURLToPath(new URL('../../../../sims/fixtures/fy-io-fifo-capture-2026-06-11.json', import.meta.url));
const capture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const srsPackets = capture.filter(p => p.plugin === 'srsSerial' && typeof p.rawData === 'string');
const collectors = new Map();
const collectorFor = (portmap, idx) => {
    const key = JSON.stringify(portmap ?? null);
    let c = collectors.get(key);
    if (!c) {
        c = new CapturingSRSCollector(srsParams(`/test/golden-${idx}`, {
            extendedOptions: { suppress: [], ...(portmap ? { portmap } : {}) }
        }));
        collectors.set(key, c);
    }
    return c;
};
void test('golden capture sanity: substantial and well-formed', () => {
    assert.ok(srsPackets.length >= 250, `expected a substantial capture, got ${srsPackets.length}`);
    srsPackets.forEach(p => {
        assert.match(p.rawData ?? '', /^[[{]([0-9a-fA-F]{2}\s*)+[\]}]$/);
    });
});
void test('every production frame decodes identically to production output', () => {
    let compared = 0;
    srsPackets.forEach((p, idx) => {
        const collector = collectorFor(p.extendedOptions?.portmap, idx);
        const formatted = collector.format(`${p.rawData ?? ''}`, new FormatHelper());
        assert.ok(formatted, `frame failed to decode: ${p.rawData ?? ''} (site: ${p.site})`);
        assert.deepEqual(formatted, p.formattedData, `decode mismatch for ${p.rawData ?? ''} (site: ${p.site}, seq: ${p.seq ?? -1})`);
        compared++;
    });
    assert.equal(compared, srsPackets.length);
});
