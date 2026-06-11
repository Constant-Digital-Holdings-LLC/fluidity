import { TermCaps } from './caps.js';
import { paint, chromeDef, styleDef } from './theme.js';
import { padEndAnsi, truncateAnsi, visibleLength } from './ansiText.js';
import { UIState, visibleEntries, viewportRows, pendingWhilePaused } from './uiModel.js';

//frame composition is pure (testable without a pty); terminal control is at the bottom

const CONN_GLYPH: Record<string, string> = {
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

export const composeFrame = (st: UIState, caps: TermCaps): string[] => {
    const tier = caps.tier;
    const w = st.cols;
    const rows: string[] = [];

    //header
    const visible = visibleEntries(st);
    const paused = st.paused ? ` PAUSED(+${pendingWhilePaused(st)})` : '';
    const scrolled = st.scrollOffset > 0 ? ` ^${st.scrollOffset}` : '';
    //status (right side) outranks the title when width is tight
    const right = ` ${CONN_GLYPH[st.conn] ?? st.conn} - ${visible.length} pkts${paused}${scrolled} `;
    const left = truncateAnsi(` Fluidity - ${st.serverHost} `, Math.max(0, w - visibleLength(right) - 2));
    const dashes = Math.max(0, w - visibleLength(left) - visibleLength(right) - 2);
    rows.push(truncateAnsi(paint(`-${left}${'-'.repeat(dashes)}${right}-`, chromeDef('separator'), tier), w));

    //viewport
    const vpRows = viewportRows(st);
    if (st.showHelp) {
        for (let i = 0; i < vpRows; i++) {
            rows.push(padEndAnsi(paint(helpLines[i] ?? '', styleDef(0), tier), w));
        }
    } else {
        const end = visible.length - st.scrollOffset;
        const slice = visible.slice(Math.max(0, end - vpRows), end);
        for (let i = 0; i < vpRows; i++) {
            const entry = slice[i];
            rows.push(entry ? padEndAnsi(truncateAnsi(entry.line, w), w) : ' '.repeat(w));
        }
    }

    //separator
    rows.push(paint('-'.repeat(w), chromeDef('separator'), tier));

    //bottom pane: who is reporting in, numbered for filter toggles
    const registry = st.group === 'sites' ? st.seenSites : st.seenCollectors;
    const selected = st.group === 'sites' ? st.filters.sites : st.filters.collectors;
    const label = st.group === 'sites' ? 'sites' : 'collectors';

    let pane = ` ${paint(label + ':', chromeDef('description'), tier)} `;
    let shown = 0;
    const names = [...registry.entries()];
    for (const [i, [name, count]] of names.entries()) {
        if (i >= 9) break;
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

    //hints
    const filterCount = st.filters.sites.length + st.filters.collectors.length;
    const hints = ` [1-9] toggle  [Tab] ${st.group === 'sites' ? 'collectors' : 'sites'}  [x] clear(${filterCount})  [space] pause  [?] help  [q] quit`;
    rows.push(padEndAnsi(paint(truncateAnsi(hints, w), styleDef(7), tier), w));

    return rows;
};

//terminal control

export const enterScreen = (out: NodeJS.WriteStream): void => {
    out.write('\x1b[?1049h\x1b[?25l'); //alt buffer, hide cursor
};

export const leaveScreen = (out: NodeJS.WriteStream): void => {
    out.write('\x1b[?25h\x1b[?1049l'); //show cursor, main buffer
};

export const drawFrame = (out: NodeJS.WriteStream, lines: string[]): void => {
    out.write('\x1b[H' + lines.map(l => l + '\x1b[K').join('\r\n'));
};
