import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialPortMock } from 'serialport';
import { FormatHelper } from '../modules/collectors.js';
import GenericSerialCollector from '../modules/collectors/genericSerial.js';
import { CapturingSRSCollector, srsParams } from './helpers.js';
void test('srsSerial format ignores garbage, partial, and zero frames', () => {
    const c = new CapturingSRSCollector(srsParams('/test/fmt-garbage'));
    const fh = new FormatHelper();
    assert.equal(c.format('hello world', fh), null);
    assert.equal(c.format('', fh), null);
    assert.equal(c.format('[zz 00 00 00 00]', fh), null);
    assert.equal(c.format('[00 00 00 00 00]', fh), null);
    assert.equal(c.format('{00 00 00 00 00 00}', fh), null);
    assert.equal(c.format('80 00 00 00 00', fh), null);
    assert.equal(c.format('>0:5<', fh), null);
});
void test('srsSerial format uses portmap names from extendedOptions', () => {
    const c = new CapturingSRSCollector(srsParams('/test/fmt-portmap', { extendedOptions: { portmap: ['Alpha', 'Bravo'], suppress: [] } }));
    const out = c.format('[02 00 00 00 00]', new FormatHelper());
    assert.deepEqual(out?.map(f => f.field), ['Radio States: ', 'Bravo:', 'COR']);
});
void test('srsSerial hides carrier-only messages by default, keeps mixed frames whole', () => {
    const c = new CapturingSRSCollector(srsParams('/test/fmt-suppress'));
    assert.equal(c.format('[01 00 00 00 00]', new FormatHelper()), null);
    assert.equal(c.format('[40 00 00 00 00]', new FormatHelper()), null);
    const mixed = c.format('[01 00 01 00 00]', new FormatHelper());
    assert.deepEqual(mixed?.map(f => f.field), ['Radio States: ', 'port-0:', 'COR,RCVACT']);
    assert.ok(c.format('{0f 01 00 00 00 1f}', new FormatHelper()));
});
void test('suppress is configurable: empty list shows everything, port states can be hidden too', () => {
    const showAll = new CapturingSRSCollector(srsParams('/test/fmt-suppress-off', { extendedOptions: { suppress: [] } }));
    assert.deepEqual(showAll.format('[01 00 00 00 00]', new FormatHelper())?.map(f => f.field), ['Radio States: ', 'port-0:', 'COR']);
    const quiet = new CapturingSRSCollector(srsParams('/test/fmt-suppress-ports', {
        extendedOptions: { suppress: ['COR', 'LINK', 'LOOPBACK', 'INTERFACED'] }
    }));
    assert.equal(quiet.format('{0f 01 00 00 00 1f}', new FormatHelper()), null);
    assert.ok(quiet.format('{00 00 01 00 00 00}', new FormatHelper()));
});
void test('srsSerial format falls back to port-N labels without a portmap', () => {
    const c = new CapturingSRSCollector(srsParams('/test/fmt-fallback'));
    const out = c.format('{80 00 00 00 00 80}', new FormatHelper());
    assert.deepEqual(out?.map(f => f.field), ['Port States: ', 'port-7:', 'LINK,INTERFACED']);
});
class MockGenericCollector extends GenericSerialCollector {
    openPort(path, baudRate) {
        SerialPortMock.binding.createPort(path);
        return new SerialPortMock({ path, baudRate });
    }
}
void test('genericSerial passes lines through unchanged', () => {
    const params = {
        ...srsParams('/test/fmt-generic'),
        plugin: 'genericSerial'
    };
    const c = new MockGenericCollector(params);
    assert.deepEqual(c.format('RFSwitch>cluster-cli enable', new FormatHelper()), [
        { suggestStyle: 0, field: 'RFSwitch>cluster-cli enable', fieldType: 'STRING' }
    ]);
});
