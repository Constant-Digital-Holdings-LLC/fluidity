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
    plugin: string;
    formattedData: FormattedData[];
    rawData?: string | null;
}

export const isFfluidityPacket = (obj: any, omitFormattedData?: boolean): obj is FluidityPacket => {
    const { site, description, plugin, formattedData, rawData } = obj ?? {};
    return (
        typeof site === 'string' &&
        Boolean(site) &&
        typeof description === 'string' &&
        Boolean(description) &&
        typeof plugin === 'string' &&
        Boolean(plugin) &&
        (omitFormattedData ? true : Array.isArray(formattedData)) &&
        (typeof rawData === 'undefined' || typeof rawData === 'string' || rawData === null)
    );
};

export interface PublishTarget {
    location: string;
    key?: string;
}

export type StringAble = {
    toString(): string;
};
