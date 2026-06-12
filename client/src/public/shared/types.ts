export interface FluidityLink {
    name: string;
    location: string;
}

export type FluidityField = string | FluidityLink;

export interface FormattedData {
    suggestStyle: number;
    field: FluidityField;
    fieldType: 'LINK' | 'DATE' | 'STRING';
}

export interface FluidityPacket {
    seq?: number;
    site: string;
    ts: string;
    description: string;
    plugin: string;
    formattedData: FormattedData[];
    rawData?: string | null;
}

export const isObject = (item: unknown): item is object => {
    return typeof item === 'object' && item !== null;
};

//C0 controls, DEL, and C1 controls (U+0080-U+009F: 8-bit CSI/OSC introducers)
//- the byte ranges every renderer must never pass to a terminal or the DOM
export const stripControlChars = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

//suggestStyle >= 100 means trim + color (style % 10) - the wire convention
//both clients decode; how color/trim render (CSS class vs ANSI) stays theirs
export const decodeSuggestStyle = (suggestStyle: number): { color: number; trim: boolean } =>
    suggestStyle >= 100 ? { color: suggestStyle % 10, trim: true } : { color: suggestStyle, trim: false };

//the one API-key alphabet, shared by agent publish and server verify
export const isApiKeyFormat = (key: unknown): key is string => typeof key === 'string' && /^[a-zA-Z0-9]+$/.test(key);

export const isFluidityLink = (item: unknown): item is FluidityLink => {
    if (!isObject(item)) {
        return false;
    }
    const { name, location } = item as Partial<FluidityLink>;

    //http(s) only and no control bytes: links render as a clickable href in
    //the browser and an OSC 8 hyperlink in the TUI, so this boundary is what
    //stands between packet data and javascript: URLs / terminal escapes
    return (
        typeof name === 'string' &&
        Boolean(name) &&
        typeof location === 'string' &&
        /^https?:\/\//i.test(location) &&
        stripControlChars(location) === location
    );
};

export const isFormattedData = (item: unknown): item is FormattedData => {
    if (!isObject(item)) {
        return false;
    }
    const { suggestStyle, field, fieldType } = item as Partial<FormattedData>;

    if (typeof suggestStyle !== 'number' || !Number.isFinite(suggestStyle)) {
        return false;
    }
    if (fieldType === 'LINK') {
        return isFluidityLink(field);
    }
    return (fieldType === 'DATE' || fieldType === 'STRING') && typeof field === 'string';
};

//forParams skips the fields stamped at send time (ts, formattedData) so the
//same guard can validate collector params
export const isFfluidityPacket = (item: unknown, forParams?: boolean): item is FluidityPacket => {
    if (!isObject(item)) {
        return false;
    }

    const { site, ts, description, plugin, formattedData, rawData } = item as Partial<FluidityPacket>;

    return (
        typeof site === 'string' &&
        Boolean(site) &&
        typeof description === 'string' &&
        Boolean(description) &&
        typeof plugin === 'string' &&
        Boolean(plugin) &&
        (forParams ||
            (typeof ts === 'string' &&
                Number.isFinite(new Date(ts).getTime()) &&
                Array.isArray(formattedData) &&
                formattedData.every(isFormattedData))) === true &&
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
