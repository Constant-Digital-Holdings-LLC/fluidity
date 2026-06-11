import { paint, chromeDef, styleDef } from './theme.js';
import { padEndAnsi, truncateAnsi, visibleLength } from './ansiText.js';
import { composeChrome } from './renderLine.js';
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
    '  j/k, arrows, PgUp/PgDn   scroll',
    '  g / G      top / bottom (G re-enables auto-scroll)',
    '  space      pause / resume',
    '  q          quit',
    '',
    '  any key to dismiss'
];
export const composeFrame = (st, caps) => {
    const tier = caps.tier;
    const w = st.cols;
    const rows = [];
    const visible = visibleEntries(st);
    const paused = st.paused ? ` PAUSED(+${pendingWhilePaused(st)})` : '';
    const scrolled = st.scrollOffset > 0 ? ` ^${st.scrollOffset}` : '';
    const right = ` ${CONN_GLYPH[st.conn] ?? st.conn} - ${visible.length} pkts${paused}${scrolled} `;
    const left = truncateAnsi(` Fluidity - ${st.serverHost} `, Math.max(0, w - visibleLength(right) - 2));
    const dashes = Math.max(0, w - visibleLength(left) - visibleLength(right) - 2);
    rows.push(truncateAnsi(paint(`-${left}${'-'.repeat(dashes)}${right}-`, chromeDef('separator'), tier), w));
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
    const names = [...registry.entries()];
    for (const [i, [name, count]] of names.entries()) {
        if (i >= 9)
            break;
        const isSel = selected.includes(name);
        const text = `[${i + 1}]${st.group === 'sites' ? name.toUpperCase() : name} ${count}`;
        const def = isSel ? { ...chromeDef('site'), bold: true, underline: tier !== 'mono' } : styleDef(7);
        const chunk = (isSel && tier === 'mono' ? `*${text}` : text) + '  ';
        if (visibleLength(pane) + chunk.length > w - 8) {
            pane += paint(`+${names.length - shown} more`, styleDef(7), tier);
            break;
        }
        pane += paint(chunk, def, tier);
        shown++;
    }
    rows.push(padEndAnsi(pane, w));
    const filterCount = st.filters.sites.length + st.filters.collectors.length;
    const hints = ` [1-9] toggle  [Tab] ${st.group === 'sites' ? 'collectors' : 'sites'}  [x] clear(${filterCount})  [space] pause  [?] help  [q] quit`;
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