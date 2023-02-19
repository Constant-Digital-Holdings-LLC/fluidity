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
    seq?: number;
    site: string;
    description: string;
    plugin: string;
    formattedData: FormattedData[];
    rawData?: string | null;
}
export declare const isObject: (value: unknown) => value is object;
export declare const isFfluidityPacket: (item: unknown, omitFormattedData?: boolean) => item is FluidityPacket;
export interface PublishTarget {
    location: string;
    key: string;
}
export type StringAble = {
    toString(): string;
};
export type NodeEnv = 'development' | 'production' | null;
//# sourceMappingURL=types.d.ts.map