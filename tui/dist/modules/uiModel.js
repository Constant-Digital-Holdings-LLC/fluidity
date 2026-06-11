import { matchesFilters } from './filters.js';
export const initialState = (cols, rows, serverHost, historyLimit) => ({
    cols,
    rows,
    serverHost,
    conn: 'connecting',
    entries: [],
    historyLimit,
    seenSites: new Map(),
    seenCollectors: new Map(),
    filters: { sites: [], collectors: [] },
    group: 'sites',
    columns: { time: 0, site: 0, desc: 0 },
    scrollOffset: 0,
    paused: false,
    pausedAtCount: 0,
    showHelp: false,
    quit: false
});
export const addPacket = (st, p, parts) => {
    st.entries.push({ site: p.site, plugin: p.plugin, parts });
    if (st.entries.length > st.historyLimit) {
        const overflow = st.entries.length - st.historyLimit;
        st.entries.splice(0, overflow);
        if (st.paused)
            st.pausedAtCount = Math.max(0, st.pausedAtCount - overflow);
    }
    st.seenSites.set(p.site, (st.seenSites.get(p.site) ?? 0) + 1);
    st.seenCollectors.set(p.plugin, (st.seenCollectors.get(p.plugin) ?? 0) + 1);
    st.columns = {
        time: Math.max(st.columns.time, parts.time.length),
        site: Math.max(st.columns.site, parts.site.length),
        desc: Math.max(st.columns.desc, parts.desc.length)
    };
};
export const visibleEntries = (st) => {
    const upTo = st.paused ? st.entries.slice(0, st.pausedAtCount) : st.entries;
    return upTo.filter(e => matchesFilters({ site: e.site, plugin: e.plugin }, st.filters));
};
export const pendingWhilePaused = (st) => (st.paused ? st.entries.length - st.pausedAtCount : 0);
const toggle = (list, value) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];
const toggleByDigit = (st, digit) => {
    const registry = st.group === 'sites' ? st.seenSites : st.seenCollectors;
    const name = [...registry.keys()][digit - 1];
    if (name === undefined)
        return;
    if (st.group === 'sites') {
        st.filters = { ...st.filters, sites: toggle(st.filters.sites, name) };
    }
    else {
        st.filters = { ...st.filters, collectors: toggle(st.filters.collectors, name) };
    }
};
export const viewportRows = (st) => Math.max(1, st.rows - 4);
export const handleKey = (st, key) => {
    if (st.showHelp && key.name !== 'quit') {
        st.showHelp = false;
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
            st.scrollOffset = 0;
            break;
        case 'pause':
            if (st.paused) {
                st.paused = false;
                st.scrollOffset = 0;
            }
            else {
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
        case 'help':
            st.showHelp = true;
            break;
        case 'digit':
            if (key.digit !== undefined) {
                toggleByDigit(st, key.digit);
                st.scrollOffset = 0;
            }
            break;
        case 'other':
            break;
    }
};
//# sourceMappingURL=uiModel.js.map