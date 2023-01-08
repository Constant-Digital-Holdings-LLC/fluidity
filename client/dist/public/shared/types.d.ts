export type CollectorType = 'generic-serial' | 'srs1-serial';
export interface DelimitedData {
    display: number;
    field: string;
}
export interface FluidityPacket {
    site: string;
    label: string;
    collectorType: CollectorType;
    delimData: DelimitedData[];
}
//# sourceMappingURL=types.d.ts.map