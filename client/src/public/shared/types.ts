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
    description: string;
    name: string;
    formattedData: FormattedData[];
    rawData?: string | null;
}

export interface PublishTarget {
    location: string;
    key?: string;
}

export type StringAble = {
    toString(): string;
};
