export type CollectorType = 'generic-serial' | 'srs-serial' | 'net-announce';

export interface FluidityLink {
    name: string;
    location: string;
}

export type FluidityField = string | Date | FluidityLink;

export interface FormattedData {
    suggestStyle: number;
    field: FluidityField;
    fieldType: 'LINK' | 'DATE' | 'STRING';
}

export interface FluidityPacket {
    site: string;
    label: string;
    collectorType: CollectorType;
    formattedData: FormattedData[];
    rawData?: string | null;
}

export interface PublishTarget {
    location: string;
    key?: string;
}
