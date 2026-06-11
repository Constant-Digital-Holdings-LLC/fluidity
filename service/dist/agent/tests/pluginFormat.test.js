import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialPortMock } from 'serialport';
import { FormatHelper } from '../modules/collectors.js';
import GenericSerialCollector from '../modules/collectors/genericSerial.js';
import { parseSrsFrame } from '../modules/collectors/srsSerial.js';
import { CapturingSRSCollector, srsParams } from './helpers.js';
void test('parseSrsFrame: strict grammar accepts exactly the documented formats', () => {
    assert.deepEqual(parseSrsFrame('[01 00 00 00 00]'), { kind: 'radio', bytes: [1, 0, 0, 0, 0] });
    assert.deepEqual(parseSrsFrame('{0f 01 00 00 00 1f}'), { kind: 'port', bytes: [15, 1, 0, 0, 0, 31] });
    assert.deepEqual(parseSrsFrame('[FF 00 00 00 0A]')?.bytes, [255, 0, 0, 0, 10]);
    assert.ok(parseSrsFrame('[01 00 00 00 00] '));
    assert.equal(parseSrsFrame('[01 00 00 00 00}'), null, 'mismatched brackets');
    assert.equal(parseSrsFrame('{01 00 00 00 00 00]'), null, 'mismatched brackets');
    assert.equal(parseSrsFrame('[01  00 00 00 00]'), null, 'double space (was: misaligned states)');
    assert.equal(parseSrsFrame('[01 0000 00 00]'), null, 'merged bytes (was: phantom port states)');
    assert.equal(parseSrsFrame('[1 00 00 00 00]'), null, 'odd hex digits');
    assert.equal(parseSrsFrame('[zz 00 00 00 00]'), null, 'non-hex');
    assert.equal(parseSrsFrame('[01 00 00 00 00]x'), null, 'trailing garbage (was: accepted)');
    assert.equal(parseSrsFrame(' [01 00 00 00 00]'), null, 'leading content');
    assert.equal(parseSrsFrame('[01 00 00 00 00][80 00 00 00 00]'), null, 'merged frames');
    assert.equal(parseSrsFrame('[01 00 00 00 00 ]'), null, 'space before bracket');
    assert.equal(parseSrsFrame(''), null);
    assert.equal(parseSrsFrame('hello'), null);
});
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
void test('srsSerial validates frame length: truncated/oversized dropped, bit-7 extras tolerated', () => {
    const c = new CapturingSRSCollector(srsParams('/test/fmt-length', { extendedOptions: { suppress: [] } }));
    const fh = new FormatHelper();
    assert.equal(c.format('[01 00]', fh), null);
    assert.equal(c.format('{0f 01 00}', fh), null);
    const plain = c.format('{0f 01 00 00 00 1f}', new FormatHelper());
    const extended = c.format('{0f 01 00 00 00 1f 03 01 00 00 00}', new FormatHelper());
    assert.ok(plain && extended);
    assert.deepEqual(extended, plain);
    assert.equal(c.format(`[${Array(17).fill('01').join(' ')}]`, fh), null);
});
void test('srsSerial passes release-to-zero frames as CLEAR, suppressed by default', () => {
    const dflt = new CapturingSRSCollector(srsParams('/test/fmt-clear-default'));
    assert.equal(dflt.format('[00 00 00 00 00]', new FormatHelper()), null);
    assert.equal(dflt.format('{00 00 00 00 00 00}', new FormatHelper()), null);
    const show = new CapturingSRSCollector(srsParams('/test/fmt-clear-shown', { extendedOptions: { suppress: [] } }));
    assert.deepEqual(show.format('[00 00 00 00 00]', new FormatHelper()), [
        { suggestStyle: 0, field: 'Radio States: ', fieldType: 'STRING' },
        { suggestStyle: 10, field: 'all clear', fieldType: 'STRING' }
    ]);
    assert.deepEqual(show.format('{00 00 00 00 00 00}', new FormatHelper())?.map(f => f.field), ['Port States: ', 'all clear']);
});
void test('srsSerial counts dropped lines by reason; suppressed frames are not drops', () => {
    const c = new CapturingSRSCollector(srsParams('/test/fmt-drops'));
    const fh = new FormatHelper();
    c.format('garbage line', fh);
    c.format('[01 00 00 00 00]x', fh);
    c.format('[01 00]', fh);
    c.format('[01 00 00 00 00]', fh);
    c.format('[00 00 00 00 00]', fh);
    assert.equal(c.dropCounts.get('not-a-frame'), 2);
    assert.equal(c.dropCounts.get('truncated'), 1);
    assert.equal(c.dropCounts.get('oversized') ?? 0, 0);
});
void test('srsSerial falls back loudly (not fatally) on invalid portmap or suppress config', () => {
    const badMap = new CapturingSRSCollector(srsParams('/test/fmt-badmap', { extendedOptions: { portmap: ['Alpha', 42], suppress: [] } }));
    assert.deepEqual(badMap.format('[02 00 00 00 00]', new FormatHelper())?.map(f => f.field), ['Radio States: ', 'port-1:', 'COR']);
    const badSuppress = new CapturingSRSCollector(srsParams('/test/fmt-badsuppress', { extendedOptions: { suppress: 'COR' } }));
    assert.equal(badSuppress.format('[01 00 00 00 00]', new FormatHelper()), null);
    assert.ok(badSuppress.format('[01 00 01 00 00]', new FormatHelper()));
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
