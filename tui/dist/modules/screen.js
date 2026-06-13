import { livenessOf, PULSE_WINDOWS } from '#@client/modules/pulse.js';
import { stripControlChars } from '#@shared/types.js';
import { paint, chromeDef, styleDef } from './theme.js';
import { padEndAnsi, truncateAnsi, visibleLength } from './ansiText.js';
import { composeChrome } from './renderLine.js';
import { stripOf } from './rateStrip.js';
import { visibleEntries, viewportRows, pendingWhilePaused } from './uiModel.js';
const CONN_GLYPH = {
    connecting: '~ connecting',
    live: '* live',
    reconnecting: '~ reconnecting',
    stopped: 'o stopped'
};
const helpLines = [
    '',
    '  fluidity-tui help',
    '',
    '  1-9        toggle filter for the numbered item below',
    '  Tab        switch the bottom pane: sites <-> collectors',
    '  x          clear all filters',
    '  w          cycle the rate strip window (5m / 1h / 24h)',
    '  v          reveal/hide vRep liveness heartbeats (debug)',
    '  j/k, arrows, PgUp/PgDn   scroll',
    '  g / G      top / bottom (G re-enables auto-scroll)',
    '  space      pause / resume',
    '  q          quit',
    '',
    '  site markers: * reporting   ~ quiet a while   . silent',
    '',
    '  any key to dismiss'
];
const ACCENT = { hex: '#fe8dc6', ansi16: 95 };
const LIVE_MARK = {
    fresh: { ch: '*', def: { hex: '#fe8dc6', ansi16: 95, bold: true } },
    recent: { ch: '~', def: { hex: '#ffdab9', ansi16: 93 } },
    stale: { ch: '.', def: { hex: '#999999', ansi16: 90, dim: true } }
};
export const composeFrame = (st, caps) => {
    const tier = caps.tier;
    const w = st.cols;
    const rows = [];
    const visible = visibleEntries(st);
    const paused = st.paused ? ` PAUSED(+${pendingWhilePaused(st)})` : '';
    const scrolled = st.scrollOffset > 0 ? ` ^${st.scrollOffset}` : '';
    const bad = st.malformed > 0 ? ` - malformed ${st.malformed}` : '';
    const right = ` ${CONN_GLYPH[st.conn] ?? st.conn} - ${visible.length} pkts${paused}${scrolled}${bad} `;
    const left = truncateAnsi(` Fluidity - ${st.serverHost} `, Math.max(0, w - visibleLength(right) - 2));
    const sep = (text) => paint(text, chromeDef('separator'), tier);
    const winLabel = PULSE_WINDOWS[st.pulseWindowIdx]?.label ?? '';
    const spare = Math.max(0, w - visibleLength(left) - visibleLength(right) - 2);
    let middle;
    if (st.rateSeries.length > 0 && spare >= 16) {
        const cells = Math.min(40, spare - winLabel.length - 4);
        const lead = spare - cells - winLabel.length - 4;
        middle =
            sep('-'.repeat(Math.max(0, lead))) +
                sep('[') +
                paint(stripOf(st.rateSeries, cells), ACCENT, tier) +
                sep(']') +
                paint(winLabel, styleDef(7), tier) +
                sep(' -');
    }
    else {
        middle = sep('-'.repeat(spare));
    }
    rows.push(truncateAnsi(sep(`-${left}`) + middle + sep(`${right}-`), w));
    const vpRows = viewportRows(st);
    if (st.showHelp) {
        for (let i = 0; i < vpRows; i++) {
            rows.push(padEndAnsi(paint(helpLines[i] ?? '', styleDef(0), tier), w));
        }
    }
    else {
        const end = visible.length - st.scrollOffset;
        const slice = visible.slice(Math.max(0, end - vpRows), end);
        for (let i = 0; i < vpRows; i++) {
            const entry = slice[i];
            const line = entry ? composeChrome(entry.parts, { caps }, st.columns) : undefined;
            rows.push(line !== undefined ? padEndAnsi(truncateAnsi(line, w), w) : ' '.repeat(w));
        }
    }
    rows.push(paint('-'.repeat(w), chromeDef('separator'), tier));
    const registry = st.group === 'sites' ? st.seenSites : st.seenCollectors;
    const selected = st.group === 'sites' ? st.filters.sites : st.filters.collectors;
    const label = st.group === 'sites' ? 'sites' : 'collectors';
    let pane = ` ${paint(label + ':', chromeDef('description'), tier)} `;
    let shown = 0;
    const now = Date.now();
    const names = [...registry.entries()];
    for (const [i, [name, count]] of names.entries()) {
        if (i >= 9) {
            pane += paint(`+${names.length - shown} more`, styleDef(7), tier);
            break;
        }
        const isSel = selected.includes(name);
        let mark = '';
        if (st.group === 'sites') {
            const seen = st.siteLastSeen.get(name);
            const live = LIVE_MARK[seen === undefined ? 'stale' : livenessOf(seen, now)];
            if (live)
                mark = paint(live.ch, live.def, tier);
        }
        const safeName = stripControlChars(name);
        const text = `[${i + 1}]${st.group === 'sites' ? safeName.toUpperCase() : safeName} ${count}`;
        const def = isSel ? { ...ACCENT, bold: true, underline: tier !== 'mono' } : styleDef(7);
        const chunkLen = (mark ? 1 : 0) + visibleLength(text) + ((isSel && tier === 'mono' ? 1 : 0) + 2);
        if (visibleLength(pane) + chunkLen > w - 8) {
            pane += paint(`+${names.length - shown} more`, styleDef(7), tier);
            break;
        }
        pane += mark + paint((isSel && tier === 'mono' ? `*${text}` : text) + '  ', def, tier);
        shown++;
    }
    rows.push(padEndAnsi(pane, w));
    const filterCount = st.filters.sites.length + st.filters.collectors.length;
    const hints = ` [1-9] toggle  [Tab] ${st.group === 'sites' ? 'collectors' : 'sites'}  [x] clear(${filterCount})  [w] ${winLabel}  [space] pause  [?] help  [q] quit`;
    rows.push(padEndAnsi(paint(truncateAnsi(hints, w), styleDef(7), tier), w));
    return rows;
};
export const enterScreen = (out) => {
    out.write('\x1b[?1049h\x1b[?25l');
};
export const leaveScreen = (out) => {
    out.write('\x1b[?25h\x1b[?1049l');
};
export const drawFrame = (out, lines) => {
    out.write('\x1b[H' + lines.map(l => l + '\x1b[K').join('\r\n'));
};
//# sourceMappingURL=screen.js.map