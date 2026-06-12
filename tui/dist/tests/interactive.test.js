import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleLength, truncateAnsi, padEndAnsi } from '../modules/ansiText.js';
import { parseKeys } from '../modules/keys.js';
import { initialState, addPacket, handleKey, visibleEntries } from '../modules/uiModel.js';
import { composeFrame } from '../modules/screen.js';
const MONO = { tier: 'mono', hyperlinks: false };
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
    assert.deepEqual(parseKeys(Buffer.from('w')), [{ name: 'window' }]);
});
const pkt = (seq, site, plugin = 'srsSerial') => ({
    seq,
    site,
    plugin,
    ts: '2026-06-11T12:00:00.000Z',
    description: 'd',
    formattedData: []
});
const parts = (fields, site = 'S', desc = 'd') => ({
    time: '12:00:00',
    site,
    desc,
    fields: ` ${fields}`
});
const populated = () => {
    const st = initialState(80, 12, 'localhost:3000', 100);
    addPacket(st, pkt(1, 'Verdugo Pk'), parts('line-1', 'Verdugo Pk'));
    addPacket(st, pkt(2, 'Loop Cyn', 'genericSerial'), parts('line-2', 'Loop Cyn'));
    addPacket(st, pkt(3, 'Verdugo Pk'), parts('line-3', 'Verdugo Pk'));
    return st;
};
void test('digit keys toggle the numbered site filter; Tab switches groups', () => {
    const st = populated();
    handleKey(st, { name: 'digit', digit: 1 });
    assert.deepEqual(st.filters.sites, ['Verdugo Pk']);
    assert.equal(visibleEntries(st).length, 2);
    handleKey(st, { name: 'digit', digit: 1 });
    assert.deepEqual(st.filters.sites, []);
    handleKey(st, { name: 'tab' });
    assert.equal(st.group, 'collectors');
    handleKey(st, { name: 'digit', digit: 2 });
    assert.deepEqual(st.filters.collectors, ['genericSerial']);
    assert.equal(visibleEntries(st).length, 1);
    handleKey(st, { name: 'clear' });
    assert.deepEqual(st.filters, { sites: [], collectors: [] });
    handleKey(st, { name: 'digit', digit: 9 });
    assert.deepEqual(st.filters, { sites: [], collectors: [] });
});
void test('pause freezes the viewport while buffering, resume re-pins', () => {
    const st = populated();
    handleKey(st, { name: 'pause' });
    addPacket(st, pkt(4, 'Saddle Pk'), parts('line-4', 'Saddle Pk'));
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
    const body = frame.slice(1, st.rows - 3).join('\n');
    assert.ok(body.includes('line-1') && body.includes('line-3'));
    assert.ok(!body.includes('line-2'));
    assert.ok(!frame.join('').includes('\x1b'));
});
void test('viewport columns align to the widest seen site/description', () => {
    const st = populated();
    const frame = composeFrame(st, MONO);
    const body = frame.slice(1, st.rows - 3).filter(l => l.trim().length > 0);
    const starts = body.map(l => l.indexOf('): line-'));
    assert.ok(starts.length >= 3);
    assert.ok(starts.every(s => s === starts[0]), `misaligned: ${JSON.stringify(starts)}`);
    const loopCyn = body.find(l => l.includes('LOOP CYN'));
    assert.ok(loopCyn?.includes('LOOP CYN  ('), `site column padded: ${loopCyn ?? ''}`);
});
void test('rate strip renders in the header and w cycles its window', () => {
    const st = populated();
    st.rateSeries = [0, 2, 5, 1, 0, 3];
    let frame = composeFrame(st, MONO);
    const header = frame[0] ?? '';
    assert.ok(header.includes('['), 'strip brackets present');
    assert.ok(header.includes('█'), 'peak cell rendered');
    assert.ok(header.includes(']5m'), 'window label shown');
    assert.ok((frame[st.rows - 1] ?? '').includes('[w] 5m'), 'hint shows the window key');
    handleKey(st, { name: 'window' });
    frame = composeFrame(st, MONO);
    assert.ok((frame[0] ?? '').includes(']1h'));
    handleKey(st, { name: 'window' });
    assert.equal(st.pulseWindowIdx, 2);
    handleKey(st, { name: 'window' });
    assert.equal(st.pulseWindowIdx, 0, 'wraps back to 5m');
    st.cols = 40;
    const narrow = composeFrame(st, MONO)[0] ?? '';
    assert.ok(!narrow.includes('['), 'no strip when there is no room');
});
void test('site entries carry liveness marks; selected pills keep the mono marker', () => {
    const st = populated();
    st.siteLastSeen.set('Verdugo Pk', Date.now());
    const frame = composeFrame(st, MONO);
    const pane = frame[st.rows - 2] ?? '';
    assert.ok(pane.includes('*[1]VERDUGO PK'), 'fresh site marked *');
    assert.ok(pane.includes('.[2]LOOP CYN'), 'quiet site marked .');
    handleKey(st, { name: 'digit', digit: 1 });
    const selected = composeFrame(st, MONO)[st.rows - 2] ?? '';
    assert.ok(selected.includes('*[1]VERDUGO PK'), 'liveness mark survives selection');
    st.rateSeries = [1, 2, 3];
    assert.ok(!composeFrame(st, MONO).join('').includes('\x1b'));
});
void test('composeFrame: scrolling and help overlay', () => {
    const st = initialState(40, 8, 'h', 100);
    for (let i = 1; i <= 20; i++)
        addPacket(st, pkt(i, 'S'), parts(`entry-${i}`));
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
//# sourceMappingURL=interactive.test.js.map