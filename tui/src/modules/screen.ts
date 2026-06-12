import { livenessOf, PULSE_WINDOWS } from '#@client/modules/pulse.js';
import { TermCaps } from './caps.js';
import { paint, chromeDef, styleDef, StyleDef } from './theme.js';
import { padEndAnsi, truncateAnsi, visibleLength } from './ansiText.js';
import { composeChrome } from './renderLine.js';
import { stripOf } from './rateStrip.js';
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
    '  w          cycle the rate strip window (5m / 1h / 24h)',
    '  j/k, arrows, PgUp/PgDn   scroll',
    '  g / G      top / bottom (G re-enables auto-scroll)',
    '  space      pause / resume',
    '  q          quit',
    '',
    '  site markers: * reporting   ~ quiet a while   . silent',
    '',
    '  any key to dismiss'
];

//brand accent (the web sparkline's pink), used for the rate strip
const ACCENT: StyleDef = { hex: '#fe8dc6', ansi16: 95 };

//liveness as shape + color so mono terminals still read it
const LIVE_MARK: Record<string, { ch: string; def: StyleDef }> = {
    fresh: { ch: '*', def: { hex: '#fe8dc6', ansi16: 95, bold: true } },
    recent: { ch: '~', def: { hex: '#ffdab9', ansi16: 93 } },
    stale: { ch: '.', def: { hex: '#999999', ansi16: 90, dim: true } }
};

export const composeFrame = (st: UIState, caps: TermCaps): string[] => {
    const tier = caps.tier;
    const w = st.cols;
    const rows: string[] = [];

    //header
    const visible = visibleEntries(st);
    const paused = st.paused ? ` PAUSED(+${pendingWhilePaused(st)})` : '';
    const scrolled = st.scrollOffset > 0 ? ` ^${st.scrollOffset}` : '';
    //status (right side) outranks the title; the rate strip fills spare room
    const right = ` ${CONN_GLYPH[st.conn] ?? st.conn} - ${visible.length} pkts${paused}${scrolled} `;
    const left = truncateAnsi(` Fluidity - ${st.serverHost} `, Math.max(0, w - visibleLength(right) - 2));
    const sep = (text: string): string => paint(text, chromeDef('separator'), tier);

    const winLabel = PULSE_WINDOWS[st.pulseWindowIdx]?.label ?? '';
    const spare = Math.max(0, w - visibleLength(left) - visibleLength(right) - 2);

    //middle = lead dashes + "[strip]label -" when there's room, plain dashes otherwise
    let middle: string;
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
    } else {
        middle = sep('-'.repeat(spare));
    }

    rows.push(truncateAnsi(sep(`-${left}`) + middle + sep(`${right}-`), w));

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
            const line = entry ? composeChrome(entry.parts, { caps }, st.columns) : undefined;
            rows.push(line !== undefined ? padEndAnsi(truncateAnsi(line, w), w) : ' '.repeat(w));
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
    const now = Date.now();
    const names = [...registry.entries()];
    for (const [i, [name, count]] of names.entries()) {
        if (i >= 9) break;
        const isSel = selected.includes(name);

        //sites carry a liveness mark (web parity: the pill dot)
        let mark = '';
        if (st.group === 'sites') {
            const seen = st.siteLastSeen.get(name);
            const live = LIVE_MARK[seen === undefined ? 'stale' : livenessOf(seen, now)];
            if (live) mark = paint(live.ch, live.def, tier);
        }

        const text = `[${i + 1}]${st.group === 'sites' ? name.toUpperCase() : name} ${count}`;
        //selected = brand pink, matching the web's "pink carries meaning"
        const def: StyleDef = isSel ? { ...ACCENT, bold: true, underline: tier !== 'mono' } : styleDef(7);
        const chunkLen = (mark ? 1 : 0) + text.length + ((isSel && tier === 'mono' ? 1 : 0) + 2);
        if (visibleLength(pane) + chunkLen > w - 8) {
            pane += paint(`+${names.length - shown} more`, styleDef(7), tier);
            break;
        }
        pane += mark + paint((isSel && tier === 'mono' ? `*${text}` : text) + '  ', def, tier);
        shown++;
    }
    rows.push(padEndAnsi(pane, w));

    //hints
    const filterCount = st.filters.sites.length + st.filters.collectors.length;
    const hints = ` [1-9] toggle  [Tab] ${st.group === 'sites' ? 'collectors' : 'sites'}  [x] clear(${filterCount})  [w] ${winLabel}  [space] pause  [?] help  [q] quit`;
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
