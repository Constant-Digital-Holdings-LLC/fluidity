export type CollectorType = 'generic-serial' | 'srs-serial';

export interface FluidityLink {
    name: string;
    location: URL;
}

const test: FluidityLink = { name: 'foo', location: new URL('http://foo.com') };

export type FluidityField = string | Date | FluidityLink;

export interface FormattedData {
    display: number;
    field: FluidityField;
    fieldType: 'link' | 'date' | 'string';
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
