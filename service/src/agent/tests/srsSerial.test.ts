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

void test('simulator stream decodes through the collector: every frame renders with suppression off', async () => {
    const stream = srsLineStream(mulberry32(3));
    const lines = Array.from({ length: 120 }, () => stream.next().value.line);

    const zeroFrames = lines.filter(l =>
        l
            .slice(1, -1)
            .split(' ')
            .every(b => parseInt(b, 16) === 0)
    );
    assert.ok(zeroFrames.length > 0, 'sample should contain release/heartbeat zero frames');
    assert.ok(zeroFrames.length < lines.length, 'sample should contain active frames');

    //suppress disabled: every well-formed frame decodes - active frames as
    //states, all-zero release/heartbeat frames as CLEAR ("all clear")
    const collector = new CapturingSRSCollector(srsParams('/test/srs-stream', { extendedOptions: { suppress: [] } }));
    const allCaptured = new Promise<void>(resolve => {
        collector.onCapture = () => {
            if (collector.captured.length === lines.length) resolve();
        };
    });

    collector.start();
    await once(collector.mockPort, 'open');

    for (const line of lines) {
        collector.mockPort.port?.emitData(line + '\r\n');
    }

    await allCaptured;

    assert.equal(collector.captured.length, lines.length);
    collector.captured.forEach(formatted => {
        const heading = formatted[0]?.field;
        assert.ok(heading === 'Radio States: ' || heading === 'Port States: ');
    });
    assert.equal(
        collector.captured.filter(f => f[1]?.field === 'all clear').length,
        zeroFrames.length,
        'every zero frame surfaces as CLEAR'
    );
    assert.equal(collector.dropCounts.size, 0, 'no sim frame may be dropped as noise');
});
