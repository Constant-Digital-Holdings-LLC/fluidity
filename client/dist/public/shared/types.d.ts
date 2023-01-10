export type CollectorType = 'generic-serial' | 'srs-serial';
export interface ProcessedData {
    display: number;
    field: string;
}
export interface FluidityPacket {
    site: string;
    label: string;
    collectorType: CollectorType;
    processedData: ProcessedData[];
    rawData?: string | null;
}
export interface PublishTarget {
    location: string;
    key?: string;
}
//# sourceMappingURL=types.d.ts.map