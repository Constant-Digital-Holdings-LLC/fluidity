export const matchesFilters = (p, f) => (f.sites.length === 0 || f.sites.includes(p.site)) &&
    (f.collectors.length === 0 || f.collectors.includes(p.plugin));
//# sourceMappingURL=filters.js.map