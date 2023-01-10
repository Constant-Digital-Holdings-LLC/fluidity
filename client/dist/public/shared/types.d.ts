export type CollectorType = 'generic-serial' | 'srs-serial';
export interface DelimitedData {
    display: number;
    field: string;
}
export interface FluidityPacket {
    site: string;
    label: string;
    collectorType: CollectorType;
    delimData: DelimitedData[];
    rawData?: string | null;
}
export interface PublishTarget {
    location: string;
    key?: string;
}
//# sourceMappingURL=types.d.ts.map