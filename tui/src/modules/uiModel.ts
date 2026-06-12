import { FluidityPacket } from '#@shared/types.js';
import { PULSE_WINDOWS } from '#@client/modules/pulse.js';
import { FilterSpec, matchesFilters } from './filters.js';
import { ConnState } from './transport.js';
import { Key } from './keys.js';
import { RenderedParts } from './renderLine.js';

//pure UI state + reducer; screen.ts turns this into a frame

export interface Entry {
    site: string;
    plugin: string;
    parts: RenderedParts; //fields pre-styled; chrome composed at paint time so columns align
}

export interface ColumnWidths {
    time: number;
    site: number;
    desc: number;
}

export type FilterGroup = 'sites' | 'collectors';

export interface UIState {
    cols: number;
    rows: number;
    serverHost: string;
    conn: ConnState;
    entries: Entry[];
    historyLimit: number;
    //insertion-ordered registries of who has reported, with packet counts
    seenSites: Map<string, number>;
    seenCollectors: Map<string, number>;
    //liveness, from packet timestamps (minute-scale thresholds shrug off skew)
    siteLastSeen: Map<string, number>;
    //rate strip: series provided by the orchestrator before each repaint
    rateSeries: number[];
    pulseWindowIdx: number;
    filters: FilterSpec;
    group: FilterGroup;
    columns: ColumnWidths; //widest seen so far; the whole window realigns as they grow
    scrollOffset: number; //lines up from the bottom; 0 = pinned (auto-scroll)
    paused: boolean;
    pausedAtCount: number;
    showHelp: boolean;
    quit: boolean;
}

export const initialState = (cols: number, rows: number, serverHost: string, historyLimit: number): UIState => ({
    cols,
    rows,
    serverHost,
    conn: 'connecting',
    entries: [],
    historyLimit,
    seenSites: new Map(),
    seenCollectors: new Map(),
    siteLastSeen: new Map(),
    rateSeries: [],
    pulseWindowIdx: 0,
    filters: { sites: [], collectors: [] },
    group: 'sites',
    columns: { time: 0, site: 0, desc: 0 },
    scrollOffset: 0,
    paused: false,
    pausedAtCount: 0,
    showHelp: false,
    quit: false
});

export const addPacket = (st: UIState, p: FluidityPacket, parts: RenderedParts): void => {
    st.entries.push({ site: p.site, plugin: p.plugin, parts });
    if (st.entries.length > st.historyLimit) {
        const overflow = st.entries.length - st.historyLimit;
        st.entries.splice(0, overflow);
        if (st.paused) st.pausedAtCount = Math.max(0, st.pausedAtCount - overflow);
    }
    st.seenSites.set(p.site, (st.seenSites.get(p.site) ?? 0) + 1);
    st.seenCollectors.set(p.plugin, (st.seenCollectors.get(p.plugin) ?? 0) + 1);

    const seenAt = new Date(p.ts).getTime();
    if (Number.isFinite(seenAt) && seenAt > (st.siteLastSeen.get(p.site) ?? 0)) {
        st.siteLastSeen.set(p.site, seenAt);
    }

    st.columns = {
        time: Math.max(st.columns.time, parts.time.length),
        site: Math.max(st.columns.site, parts.site.length),
        desc: Math.max(st.columns.desc, parts.desc.length)
    };
};

export const visibleEntries = (st: UIState): Entry[] => {
    const upTo = st.paused ? st.entries.slice(0, st.pausedAtCount) : st.entries;
    return upTo.filter(e => matchesFilters({ site: e.site, plugin: e.plugin } as FluidityPacket, st.filters));
};

export const pendingWhilePaused = (st: UIState): number => (st.paused ? st.entries.length - st.pausedAtCount : 0);

const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

//digit keys address the Nth member of the active group's registry (insertion order)
const toggleByDigit = (st: UIState, digit: number): void => {
    const registry = st.group === 'sites' ? st.seenSites : st.seenCollectors;
    const name = [...registry.keys()][digit - 1];
    if (name === undefined) return;

    if (st.group === 'sites') {
        st.filters = { ...st.filters, sites: toggle(st.filters.sites, name) };
    } else {
        st.filters = { ...st.filters, collectors: toggle(st.filters.collectors, name) };
    }
};

export const viewportRows = (st: UIState): number => Math.max(1, st.rows - 4); //header + separator + pane + hints

export const handleKey = (st: UIState, key: Key): void => {
    if (st.showHelp && key.name !== 'quit') {
        st.showHelp = false; //any key dismisses help
        return;
    }

    const page = viewportRows(st);
    const maxOffset = Math.max(0, visibleEntries(st).length - page);

    switch (key.name) {
        case 'quit':
            st.quit = true;
            break;
        case 'up':
            st.scrollOffset = Math.min(maxOffset, st.scrollOffset + 1);
            break;
        case 'down':
            st.scrollOffset = Math.max(0, st.scrollOffset - 1);
            break;
        case 'pageUp':
            st.scrollOffset = Math.min(maxOffset, st.scrollOffset + page);
            break;
        case 'pageDown':
            st.scrollOffset = Math.max(0, st.scrollOffset - page);
            break;
        case 'top':
            st.scrollOffset = maxOffset;
            break;
        case 'bottom':
            st.scrollOffset = 0; //re-pin auto-scroll
            break;
        case 'pause':
            if (st.paused) {
                st.paused = false;
                st.scrollOffset = 0;
            } else {
                st.paused = true;
                st.pausedAtCount = st.entries.length;
            }
            break;
        case 'tab':
            st.group = st.group === 'sites' ? 'collectors' : 'sites';
            break;
        case 'clear':
            st.filters = { sites: [], collectors: [] };
            break;
        case 'window':
            st.pulseWindowIdx = (st.pulseWindowIdx + 1) % PULSE_WINDOWS.length;
            break;
        case 'help':
            st.showHelp = true;
            break;
        case 'digit':
            if (key.digit !== undefined) {
                toggleByDigit(st, key.digit);
                st.scrollOffset = 0; //filter changes re-pin, like the web client
            }
            break;
        case 'other':
            break;
    }
};
