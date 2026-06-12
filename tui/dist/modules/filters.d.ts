import { FluidityPacket } from '#@shared/types.js';
export interface FilterSpec {
    sites: string[];
    collectors: string[];
}
export declare const matchesFilters: (p: Pick<FluidityPacket, "site" | "plugin">, f: FilterSpec) => boolean;
//# sourceMappingURL=filters.d.ts.map