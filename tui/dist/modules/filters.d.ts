import { FluidityPacket } from '#@shared/types.js';
export interface FilterSpec {
    sites: string[];
    collectors: string[];
}
export declare const matchesFilters: (p: FluidityPacket, f: FilterSpec) => boolean;
//# sourceMappingURL=filters.d.ts.map