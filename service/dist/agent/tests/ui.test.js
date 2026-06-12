import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="container-main">
    <ul id="site-filter-list"></ul>
    <ul id="collector-filter-list"></ul>
    <span id="visibile-count"></span>
    <span id="filter-count"></span>
    <div id="loader"></div>
    <div id="cell-data">
      <div id="history-data"></div>
      <div id="current-data"></div>
      <div id="end-data"></div>
    </div>
  </div>
</body></html>`);
const g = globalThis;
g['window'] = dom.window;
g['document'] = dom.window.document;
g['HTMLElement'] = dom.window.HTMLElement;
g['HTMLDivElement'] = dom.window.HTMLDivElement;
g['Element'] = dom.window.Element;
g['NodeList'] = dom.window.NodeList;
g['MouseEvent'] = dom.window.MouseEvent;
dom.window.HTMLElement.prototype.scrollIntoView = () => { };
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get() {
        return this.textContent ?? '';
    },
    set(value) {
        this.textContent = value;
    }
});
const { FluidityUI } = await import('#@client/modules/ui.js');
const str = (field, suggestStyle = 0) => ({ suggestStyle, field, fieldType: 'STRING' });
const pkt = (seq, site, plugin, formattedData) => ({
    seq,
    site,
    plugin,
    ts: '2026-06-11T12:00:00.000Z',
    description: `${site} device`,
    formattedData: formattedData ?? [str(`payload-${seq}`)]
});
const byId = (id) => {
    const el = dom.window.document.getElementById(id);
    assert.ok(el, `missing #${id}`);
    return el;
};
const history = [
    pkt(1, 'Verdugo Pk', 'srsSerial'),
    pkt(2, 'Loop Cyn', 'genericSerial'),
    pkt(3, 'Verdugo Pk', 'srsSerial')
];
const ui = new FluidityUI(history);
void test('history packets render with seq ids and packet structure', () => {
    const historyElem = byId('history-data');
    assert.equal(historyElem.childElementCount, 3);
    assert.ok(dom.window.document.getElementById('fp-seq-1'));
    assert.ok(dom.window.document.getElementById('fp-seq-3'));
    const first = byId('fp-seq-1');
    assert.match(first.textContent ?? '', /Verdugo Pk\(/);
    assert.match(first.textContent ?? '', /payload-1/);
});
void test('filter links are rendered once per unique site and collector', () => {
    assert.equal(byId('site-filter-list').querySelectorAll('a.filter-link').length, 2);
    assert.equal(byId('collector-filter-list').querySelectorAll('a.filter-link').length, 2);
    assert.ok(dom.window.document.getElementById('filter-site-Verdugo Pk'));
});
void test('packetAdd renders only packets newer than the history demarcation', () => {
    ui.packetAdd(pkt(2, 'Loop Cyn', 'genericSerial'));
    assert.equal(byId('current-data').childElementCount, 0);
    ui.packetAdd(pkt(4, 'Loop Cyn', 'genericSerial'));
    assert.equal(byId('current-data').childElementCount, 1);
    assert.ok(dom.window.document.getElementById('fp-seq-4'));
});
void test('LINK and DATE fields render as anchor and time elements', () => {
    ui.packetAdd(pkt(5, 'Loop Cyn', 'hamLive', [
        { suggestStyle: 6, field: { name: 'Test Net', location: 'https://ham.live/x' }, fieldType: 'LINK' },
        { suggestStyle: 3, field: '2026-06-11T12:30:00.000Z', fieldType: 'DATE' },
        str('plain', 2)
    ]));
    const el = byId('fp-seq-5');
    const a = el.querySelector('a.fp-link');
    assert.ok(a, 'LINK field should render an anchor');
    assert.equal(a.getAttribute('href'), 'https://ham.live/x');
    assert.equal(a.textContent, 'Test Net');
    assert.ok(el.querySelector('span.fp-date'), 'DATE field should render a date span');
    assert.ok(el.querySelector('span.fp-color-2'), 'STRING style class applied');
});
const click = (el) => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
};
void test('pills are toggles: click filters, click again to clear', async () => {
    const siteLink = byId('filter-site-Verdugo Pk');
    const pill = siteLink.closest('li');
    assert.ok(pill);
    click(siteLink);
    await sleep(20);
    assert.ok(!byId('fp-seq-1').classList.contains('display-none'), 'matching site stays visible');
    assert.ok(byId('fp-seq-2').classList.contains('display-none'), 'other site hidden');
    assert.equal(byId('filter-count').textContent, '1');
    assert.ok(pill.classList.contains('filter-selected'), 'pill shows selected state');
    assert.equal(siteLink.getAttribute('aria-pressed'), 'true');
    click(siteLink);
    await sleep(20);
    assert.ok(!byId('fp-seq-2').classList.contains('display-none'), 'second click restores visibility');
    assert.equal(byId('filter-count').textContent, '0');
    assert.ok(!pill.classList.contains('filter-selected'));
    assert.equal(siteLink.getAttribute('aria-pressed'), 'false');
});
void test('the whole pill is the click target, not just the label', async () => {
    const pill = byId('filter-site-Verdugo Pk').closest('li');
    assert.ok(pill);
    const typeIcon = pill.querySelector('i.fa-tower-cell');
    assert.ok(typeIcon, 'site pill carries its type icon');
    click(typeIcon);
    await sleep(20);
    assert.ok(pill.classList.contains('filter-selected'));
    assert.equal(byId('filter-count').textContent, '1');
    click(pill);
    await sleep(20);
    assert.ok(!pill.classList.contains('filter-selected'));
    assert.equal(byId('filter-count').textContent, '0');
});
void test('site pills carry a liveness dot that decays as the site goes quiet', () => {
    const dot = byId('live-site-Verdugo Pk');
    assert.ok(dot.classList.contains('live-dot'));
    const seen = new Date('2026-06-11T12:00:00.000Z').getTime();
    ui.refreshLiveness(seen + 60_000);
    assert.ok(dot.classList.contains('live-dot--fresh'), 'reported a minute ago: fresh');
    ui.refreshLiveness(seen + 5 * 60_000);
    assert.ok(dot.classList.contains('live-dot--recent'), 'five minutes quiet: recent');
    assert.ok(!dot.classList.contains('live-dot--fresh'));
    ui.refreshLiveness(seen + 30 * 60_000);
    assert.ok(dot.classList.contains('live-dot--stale'), 'half an hour quiet: stale');
});
void test('drawSparkline is harmless where canvas is unavailable (jsdom)', async () => {
    const { drawSparkline } = await import('#@client/modules/pulse.js');
    const canvas = dom.window.document.createElement('canvas');
    assert.doesNotThrow(() => drawSparkline(canvas, [0, 1, 3, 2, 5]));
});
void test('typewriter reveals characters in document order across styled spans', async () => {
    const { typeIn } = await import('#@client/modules/typewriter.js');
    const root = dom.window.document.createElement('div');
    root.innerHTML = '<span>AB</span><span>CD</span><a>EF</a>';
    dom.window.document.body.appendChild(root);
    const frames = [];
    let clock = 1000;
    typeIn(root, { cps: 1000, raf: cb => frames.push(cb), now: () => clock });
    assert.equal(root.textContent, '', 'text blanked before typing starts');
    clock = 1001;
    frames.shift()?.(clock);
    assert.equal(root.textContent, 'AB');
    clock = 1004;
    frames.shift()?.(clock);
    assert.equal(root.textContent, 'ABCDE');
    clock = 1010;
    frames.shift()?.(clock);
    assert.equal(root.textContent, 'ABCDEF');
    assert.equal(frames.length, 0, 'no frame scheduled after completion');
    root.remove();
});
void test('typewriter no-ops to instant text without a frame source', async () => {
    const { typeIn } = await import('#@client/modules/typewriter.js');
    const root = dom.window.document.createElement('div');
    root.innerHTML = '<span>hello</span>';
    typeIn(root);
    assert.equal(root.textContent, 'hello');
});
void test('renderPulse draws once sized, and does not clear-by-resize on repaint', async () => {
    const { renderPulse } = await import('#@client/modules/pulse.js');
    const calls = [];
    const ctx = new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'createLinearGradient')
                return () => ({ addColorStop: () => undefined });
            return (...args) => {
                calls.push(prop === 'fillText' ? `fillText:${String(args[0])}` : prop);
            };
        }
    });
    let width = 0;
    let height = 0;
    const canvas = {
        getContext: () => ctx,
        clientWidth: 200,
        clientHeight: 30,
        get width() {
            return width;
        },
        set width(v) {
            width = v;
            calls.push('RESIZE');
        },
        get height() {
            return height;
        },
        set height(v) {
            height = v;
        }
    };
    const pts = [
        { t: 1000, v: 0 },
        { t: 2000, v: 3 },
        { t: 3000, v: 1 }
    ];
    renderPulse(canvas, pts, { now: 3000, windowMs: 2000, label: '5m' });
    renderPulse(canvas, pts, { now: 3500, windowMs: 2000, label: '5m' });
    assert.equal(calls.filter(c => c === 'RESIZE').length, 1, 'resize only when size truly changes');
    assert.ok(calls.includes('stroke') && calls.includes('fill'), 'line and fill drawn');
    assert.ok(calls.includes('fillText:5m'), 'window label drawn');
});
void test('site and collector filters intersect', async () => {
    click(byId('filter-site-Verdugo Pk'));
    click(byId('filter-collector-genericSerial'));
    await sleep(20);
    ['fp-seq-1', 'fp-seq-2', 'fp-seq-3', 'fp-seq-4'].forEach(id => {
        assert.ok(byId(id).classList.contains('display-none'), `${id} should be hidden by intersection`);
    });
    click(byId('filter-site-Verdugo Pk'));
    click(byId('filter-collector-genericSerial'));
    await sleep(20);
    assert.equal(byId('filter-count').textContent, '0');
});
void test('live lines type in at a calm rate, then render instantly once the stream floods', async () => {
    const { FluidityUI: UI } = await import('#@client/modules/ui.js');
    let clock = 100_000;
    const typed = [];
    const fresh = new UI([pkt(900, 'Verdugo Pk', 'srsSerial')]);
    fresh.now = () => clock;
    fresh.typeFn = (el) => {
        typed.push(el.id);
    };
    for (let i = 0; i < 6; i++) {
        clock += 50;
        fresh.packetAdd(pkt(901 + i, 'Verdugo Pk', 'srsSerial'));
    }
    assert.equal(typed.length, 6, 'first six live lines animate');
    for (let i = 0; i < 6; i++) {
        clock += 50;
        fresh.packetAdd(pkt(920 + i, 'Verdugo Pk', 'srsSerial'));
    }
    assert.equal(typed.length, 6, 'flooded lines are not animated');
    clock += 2000;
    fresh.packetAdd(pkt(950, 'Verdugo Pk', 'srsSerial'));
    assert.equal(typed.length, 7, 'typing resumes once the burst subsides');
});
void test('floodBypass thresholds on a trailing one-second window', async () => {
    const { FluidityUI: UI } = await import('#@client/modules/ui.js');
    const inst = new UI([]);
    let bypassed = false;
    for (let i = 0; i < 7; i++)
        bypassed = inst.floodBypass(1000);
    assert.ok(bypassed, 'the 7th arrival inside the window bypasses');
    assert.equal(inst.floodBypass(3000), false, 'stale arrivals expire from the window');
});
void test('drainRenderQueue: bounded budget per frame, sheds oldest backlog beyond cap', async () => {
    const { drainRenderQueue } = await import('#@client/modules/rxPump.js');
    const q = Array.from({ length: 300 }, (_, i) => i);
    const seen = [];
    const r = drainRenderQueue(q, { budget: 48, cap: 256 }, x => seen.push(x));
    assert.equal(r.dropped, 44, 'oldest 44 shed to honor the cap');
    assert.equal(r.rendered, 48, 'only a frame budget rendered');
    assert.deepEqual(seen, Array.from({ length: 48 }, (_, i) => 44 + i), 'rendered in arrival order after the shed');
    assert.equal(q.length, 300 - 44 - 48, 'remainder stays queued for the next frame');
});
void test('drainRenderQueue: under the cap nothing is dropped; null render only sheds', async () => {
    const { drainRenderQueue } = await import('#@client/modules/rxPump.js');
    const q = [1, 2, 3];
    const seen = [];
    const r = drainRenderQueue(q, { budget: 48, cap: 256 }, x => seen.push(x));
    assert.equal(r.dropped, 0);
    assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(q.length, 0, 'a small queue drains fully within one frame');
    const big = Array.from({ length: 400 }, (_, i) => i);
    const r2 = drainRenderQueue(big, { budget: 48, cap: 256 }, null);
    assert.equal(r2.rendered, 0, 'no render before the UI is ready');
    assert.equal(r2.dropped, 400 - 256, 'but the backlog is still shed to the cap');
    assert.equal(big.length, 256);
});
void test('malformed timestamps render a marker, never the literal "Invalid Date"', () => {
    const fresh = new FluidityUI([pkt(4999, 'Bad Clock', 'srsSerial')]);
    fresh.packetAdd({
        seq: 5000,
        site: 'Bad Clock',
        plugin: 'srsSerial',
        ts: 'not-a-real-timestamp',
        description: 'Bad Clock device',
        formattedData: [str('payload'), { suggestStyle: 3, field: 'also-not-a-date', fieldType: 'DATE' }]
    });
    const el = byId('fp-seq-5000');
    const text = el.textContent ?? '';
    assert.ok(!text.includes('Invalid Date'), 'never shows the literal Invalid Date');
    assert.match(text, /--:--/, 'falls back to a clear marker for the packet ts');
    const dateSpan = el.querySelector('span.fp-date');
    assert.equal(dateSpan?.textContent, '--:--', 'a malformed DATE field also falls back');
});
void test('colorbar: the npm-run-colorbar packet renders every style with its fp-color-N class', async () => {
    const { colorBarPacket, COLORBAR_STYLES } = await import('../bin/colorbar.js');
    assert.equal(COLORBAR_STYLES.length, 11, 'the bar spans styles 0..10');
    const fresh = new FluidityUI([pkt(7000, 'COLORBAR', 'colorbar')]);
    fresh.packetAdd({ ...colorBarPacket(), seq: 7001 });
    const el = byId('fp-seq-7001');
    for (const { style, name } of COLORBAR_STYLES) {
        const span = el.querySelector(`span.fp-color-${style}`);
        assert.ok(span, `style ${style} renders a span.fp-color-${style}`);
        assert.equal(span.textContent, `${style}:${name}`, `style ${style} carries its legend`);
    }
});
void test('resync re-baselines the demarcation so the stream survives a server restart', () => {
    const restartUi = new FluidityUI([pkt(9100, 'Restart Site', 'srsSerial')]);
    restartUi.packetAdd(pkt(9001, 'Restart Site', 'srsSerial'));
    assert.equal(byId('current-data').querySelector('#fp-seq-9001'), null, 'pre-resync: low-seq packet dropped');
    restartUi.resync([pkt(9000, 'Restart Site', 'srsSerial')]);
    restartUi.packetAdd(pkt(9001, 'Restart Site', 'srsSerial'));
    assert.ok(dom.window.document.getElementById('fp-seq-9001'), 'post-resync: the live stream resumes');
});
void test('resync to an empty (freshly restarted) FIFO still renders the next packet', () => {
    const u = new FluidityUI([pkt(9200, 'Fresh Site', 'srsSerial')]);
    u.resync([]);
    u.packetAdd(pkt(1, 'Fresh Site', 'srsSerial'));
    assert.ok(dom.window.document.getElementById('fp-seq-1'), "a brand-new server's first packet renders");
});
