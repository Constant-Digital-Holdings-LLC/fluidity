import { FluidityPacket } from '#@shared/types.js';

//web FilterManager semantics: selections within a group are OR'd,
//the site and collector groups are AND'd (intersection)

export interface FilterSpec {
    sites: string[];
    collectors: string[];
}

export const matchesFilters = (p: FluidityPacket, f: FilterSpec): boolean =>
    (f.sites.length === 0 || f.sites.includes(p.site)) &&
    (f.collectors.length === 0 || f.collectors.includes(p.plugin));
