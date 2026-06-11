import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { FormattedData } from '#@shared/types.js';
import { srsLineStream, mulberry32 } from '#@sims/index.js';
import { CapturingSRSCollector, srsParams } from './helpers.js';

void test('SRS radio-state frame decodes to expected FormattedData', async () => {
    const collector = new CapturingSRSCollector(srsParams('/test/srs-decode'));
    const captured = new Promise<FormattedData[]>(resolve => {
        collector.onCapture = resolve;
    });

    collector.start();
    await once(collector.mockPort, 'open');

    //0x80 (COR) -> bit 7, 0x01 (XMIT_ON) -> bit 0
    collector.mockPort.port?.emitData('[80 00 00 00 01]\r\n');

    assert.deepEqual(await captured, [
        { suggestStyle: 0, field: 'Radio States: ', fieldType: 'STRING' },
        { suggestStyle: 3, field: 'port-0:', fieldType: 'STRING' },
        { suggestStyle: 9, field: 'XMIT_ON', fieldType: 'STRING' },
        { suggestStyle: 3, field: 'port-7:', fieldType: 'STRING' },
        { suggestStyle: 9, field: 'COR', fieldType: 'STRING' }
    ]);
});

void test('simulator stream decodes through the collector: active frames render, zero frames drop', async () => {
    const stream = srsLineStream(mulberry32(3));
    const lines = Array.from({ length: 120 }, () => stream.next().value.line);

    //the collector renders any frame with a set bit; all-zero release/heartbeat
    //frames decode to nothing and are intentionally dropped
    const expectActive = lines.filter(l =>
        l
            .slice(1, -1)
            .split(' ')
            .some(b => parseInt(b, 16) !== 0)
    );
    assert.ok(expectActive.length > 0, 'sample should contain active frames');
    assert.ok(expectActive.length < lines.length, 'sample should contain zero frames');

    const collector = new CapturingSRSCollector(srsParams('/test/srs-stream'));
    const allCaptured = new Promise<void>(resolve => {
        collector.onCapture = () => {
            if (collector.captured.length === expectActive.length) resolve();
        };
    });

    collector.start();
    await once(collector.mockPort, 'open');

    for (const line of lines) {
        collector.mockPort.port?.emitData(line + '\r\n');
    }

    await allCaptured;

    assert.equal(collector.captured.length, expectActive.length);
    collector.captured.forEach(formatted => {
        const heading = formatted[0]?.field;
        assert.ok(heading === 'Radio States: ' || heading === 'Port States: ');
    });
});
