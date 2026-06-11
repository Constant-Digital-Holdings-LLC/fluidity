import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { FluidityPacket, FormattedData } from '#@shared/types.js';

//dashboard skeleton matching the ids index.ejs provides
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

//ui.ts runs against browser globals; provide them before importing the module
const g = globalThis as Record<string, unknown>;
g['window'] = dom.window;
g['document'] = dom.window.document;
g['HTMLElement'] = dom.window.HTMLElement;
g['HTMLDivElement'] = dom.window.HTMLDivElement;
g['Element'] = dom.window.Element;
g['NodeList'] = dom.window.NodeList;
g['MouseEvent'] = dom.window.MouseEvent;
dom.window.HTMLElement.prototype.scrollIntoView = () => {}; //not implemented by jsdom
//jsdom doesn't implement innerText (ui.ts uses it for all text); map it to textContent
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement): string {
        return this.textContent ?? '';
    },
    set(this: HTMLElement, value: string) {
        this.textContent = value;
    }
});

const { FluidityUI } = await import('#@client/modules/ui.js');

const str = (field: string, suggestStyle = 0): FormattedData => ({ suggestStyle, field, fieldType: 'STRING' });

const pkt = (seq: number, site: string, plugin: string, formattedData?: FormattedData[]): FluidityPacket => ({
    seq,
    site,
    plugin,
    ts: '2026-06-11T12:00:00.000Z',
    description: `${site} device`,
    formattedData: formattedData ?? [str(`payload-${seq}`)]
});

const byId = (id: string): HTMLElement => {
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
    //two unique sites, two unique plugins across three packets
    assert.equal(byId('site-filter-list').querySelectorAll('a.filter-link').length, 2);
    assert.equal(byId('collector-filter-list').querySelectorAll('a.filter-link').length, 2);

    //site names containing spaces survive the id round-trip
    assert.ok(dom.window.document.getElementById('filter-site-Verdugo Pk'));
});

void test('packetAdd renders only packets newer than the history demarcation', () => {
    ui.packetAdd(pkt(2, 'Loop Cyn', 'genericSerial')); //seq <= demarc(3): ignored
    assert.equal(byId('current-data').childElementCount, 0);

    ui.packetAdd(pkt(4, 'Loop Cyn', 'genericSerial'));
    assert.equal(byId('current-data').childElementCount, 1);
    assert.ok(dom.window.document.getElementById('fp-seq-4'));
});

void test('LINK and DATE fields render as anchor and time elements', () => {
    ui.packetAdd(
        pkt(5, 'Loop Cyn', 'hamLive', [
            { suggestStyle: 6, field: { name: 'Test Net', location: 'https://ham.live/x' }, fieldType: 'LINK' },
            { suggestStyle: 3, field: '2026-06-11T12:30:00.000Z', fieldType: 'DATE' },
            str('plain', 2)
        ])
    );

    const el = byId('fp-seq-5');
    const a = el.querySelector('a.fp-link');
    assert.ok(a, 'LINK field should render an anchor');
    assert.equal(a.getAttribute('href'), 'https://ham.live/x');
    assert.equal(a.textContent, 'Test Net');
    assert.ok(el.querySelector('span.fp-date'), 'DATE field should render a date span');
    assert.ok(el.querySelector('span.fp-color-2'), 'STRING style class applied');
});

void test('clicking a site filter hides other sites; clearing restores them', async () => {
    const siteLink = byId('filter-site-Verdugo Pk');
    siteLink.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await sleep(20);

    assert.ok(!byId('fp-seq-1').classList.contains('display-none'), 'matching site stays visible');
    assert.ok(byId('fp-seq-2').classList.contains('display-none'), 'other site hidden');
    assert.equal(byId('filter-count').textContent, '1');

    const clear = byId('clear-site-Verdugo Pk');
    assert.ok(!clear.classList.contains('display-none'), 'clear control revealed after filtering');
    clear.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await sleep(20);

    assert.ok(!byId('fp-seq-2').classList.contains('display-none'), 'cleared filter restores visibility');
    assert.equal(byId('filter-count').textContent, '0');
});

void test('site and collector filters intersect', async () => {
    //filter site=Verdugo Pk AND collector=genericSerial: nothing matches both
    byId('filter-site-Verdugo Pk').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    byId('filter-collector-genericSerial').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await sleep(20);

    ['fp-seq-1', 'fp-seq-2', 'fp-seq-3', 'fp-seq-4'].forEach(id => {
        assert.ok(byId(id).classList.contains('display-none'), `${id} should be hidden by intersection`);
    });

    //cleanup: clear both filters
    byId('clear-site-Verdugo Pk').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    byId('clear-collector-genericSerial').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await sleep(20);
    assert.equal(byId('filter-count').textContent, '0');
});
