import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluidityPacket } from '#@shared/types.js';
import { visibleLength, truncateAnsi, padEndAnsi } from '../modules/ansiText.js';
import { parseKeys } from '../modules/keys.js';
import { initialState, addPacket, handleKey, visibleEntries, UIState } from '../modules/uiModel.js';
import { composeFrame } from '../modules/screen.js';
import { TermCaps } from '../modules/caps.js';

const MONO: TermCaps = { tier: 'mono', hyperlinks: false };

void test('ansiText: visible length and truncation ignore SGR sequences', () => {
    const styled = '\x1b[1;94mhello\x1b[0m world';
    assert.equal(visibleLength(styled), 11);
    assert.equal(truncateAnsi(styled, 5), '\x1b[1;94mhello\x1b[0m');
    assert.equal(visibleLength(truncateAnsi(styled, 8)), 8);
    assert.equal(visibleLength(padEndAnsi(styled, 20)), 20);
    assert.equal(padEndAnsi('ab', 4), 'ab  ');
});

void test('keys: parses vim keys, arrows, page keys, digits and controls', () => {
    assert.deepEqual(parseKeys(Buffer.from('q')), [{ name: 'quit' }]);
    assert.deepEqual(parseKeys(Buffer.from('\x03')), [{ name: 'quit' }]);
    assert.deepEqual(parseKeys(Buffer.from('jk')), [{ name: 'down' }, { name: 'up' }]);
    assert.deepEqual(parseKeys(Buffer.from('\x1b[A')), [{ name: 'up' }]);
    assert.deepEqual(parseKeys(Buffer.from('\x1b[6~')), [{ name: 'pageDown' }]);
    assert.deepEqual(parseKeys(Buffer.from('gG x?\t')), [
        { name: 'top' },
        { name: 'bottom' },
        { name: 'pause' },
        { name: 'clear' },
        { name: 'help' },
        { name: 'tab' }
    ]);
    assert.deepEqual(parseKeys(Buffer.from('3')), [{ name: 'digit', digit: 3 }]);
});

const pkt = (seq: number, site: string, plugin = 'srsSerial'): FluidityPacket => ({
    seq,
    site,
    plugin,
    ts: '2026-06-11T12:00:00.000Z',
    description: 'd',
    formattedData: []
});

const populated = (): UIState => {
    const st = initialState(80, 12, 'localhost:3000', 100);
    addPacket(st, pkt(1, 'Verdugo Pk'), 'line-1');
    addPacket(st, pkt(2, 'Loop Cyn', 'genericSerial'), 'line-2');
    addPacket(st, pkt(3, 'Verdugo Pk'), 'line-3');
    return st;
};

void test('digit keys toggle the numbered site filter; Tab switches groups', () => {
    const st = populated();

    handleKey(st, { name: 'digit', digit: 1 }); //first seen site = Verdugo Pk
    assert.deepEqual(st.filters.sites, ['Verdugo Pk']);
    assert.equal(visibleEntries(st).length, 2);

    handleKey(st, { name: 'digit', digit: 1 }); //toggle off
    assert.deepEqual(st.filters.sites, []);

    handleKey(st, { name: 'tab' });
    assert.equal(st.group, 'collectors');
    handleKey(st, { name: 'digit', digit: 2 }); //second seen collector = genericSerial
    assert.deepEqual(st.filters.collectors, ['genericSerial']);
    assert.equal(visibleEntries(st).length, 1);

    handleKey(st, { name: 'clear' });
    assert.deepEqual(st.filters, { sites: [], collectors: [] });

    //out-of-range digit is a no-op
    handleKey(st, { name: 'digit', digit: 9 });
    assert.deepEqual(st.filters, { sites: [], collectors: [] });
});

void test('pause freezes the viewport while buffering, resume re-pins', () => {
    const st = populated();

    handleKey(st, { name: 'pause' });
    addPacket(st, pkt(4, 'Saddle Pk'), 'line-4');
    assert.equal(visibleEntries(st).length, 3, 'frozen at pause point');

    handleKey(st, { name: 'pause' });
    assert.equal(visibleEntries(st).length, 4);
    assert.equal(st.scrollOffset, 0, 'resume re-pins');
});

void test('composeFrame: bottom pane lists reporting sites with counts and selection', () => {
    const st = populated();
    handleKey(st, { name: 'digit', digit: 1 });

    const frame = composeFrame(st, MONO);
    assert.equal(frame.length, st.rows);

    const header = frame[0] ?? '';
    assert.ok(header.includes('localhost:3000'));
    assert.ok(header.includes('connecting'));

    const pane = frame[st.rows - 2] ?? '';
    assert.ok(pane.includes('sites:'));
    assert.ok(pane.includes('*[1]VERDUGO PK 2'), `selected site marked: ${pane}`);
    assert.ok(pane.includes('[2]LOOP CYN 1'));

    const hints = frame[st.rows - 1] ?? '';
    assert.ok(hints.includes('[x] clear(1)'));

    //viewport shows only the filtered entries
    const body = frame.slice(1, st.rows - 3).join('\n');
    assert.ok(body.includes('line-1') && body.includes('line-3'));
    assert.ok(!body.includes('line-2'));

    //mono frames carry no escapes
    assert.ok(!frame.join('').includes('\x1b'));
});

void test('composeFrame: scrolling and help overlay', () => {
    const st = initialState(40, 8, 'h', 100);
    for (let i = 1; i <= 20; i++) addPacket(st, pkt(i, 'S'), `entry-${i}`);

    //pinned: newest at the bottom of the viewport
    let frame = composeFrame(st, MONO);
    assert.ok(frame.slice(1, 5).join('').includes('entry-20'));

    handleKey(st, { name: 'pageUp' });
    frame = composeFrame(st, MONO);
    assert.ok(!frame.slice(1, 5).join('').includes('entry-20'));
    assert.ok((frame[0] ?? '').includes('^4'), 'scroll indicator');

    handleKey(st, { name: 'bottom' });
    assert.equal(st.scrollOffset, 0);

    handleKey(st, { name: 'help' });
    frame = composeFrame(st, MONO);
    assert.ok(frame.join('\n').includes('toggle filter'), 'help overlay shown');
    handleKey(st, { name: 'other' });
    assert.equal(st.showHelp, false, 'any key dismisses');
});
