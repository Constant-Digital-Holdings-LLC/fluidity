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

export const isObject = (value: unknown): value is object => {
    return typeof value === 'object' && value !== null;
};

export const isFfluidityPacket = (item: unknown, omitFormattedData?: boolean): item is FluidityPacket => {
    if (!isObject(item)) {
        return false;
    }

    const { site, description, plugin, formattedData, rawData } = item as Partial<FluidityPacket>;

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
    key: string;
}

export type StringAble = {
    toString(): string;
};

export type NodeEnv = 'development' | 'production' | null;
