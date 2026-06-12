import { FluidityPacket } from '#@shared/types.js';

//web FilterManager semantics: selections within a group are OR'd,
//the site and collector groups are AND'd (intersection)

export interface FilterSpec {
    sites: string[];
    collectors: string[];
}

//only site/plugin are read, so both packets and UI entries type-check
export const matchesFilters = (p: Pick<FluidityPacket, 'site' | 'plugin'>, f: FilterSpec): boolean =>
    (f.sites.length === 0 || f.sites.includes(p.site)) &&
    (f.collectors.length === 0 || f.collectors.includes(p.plugin));
