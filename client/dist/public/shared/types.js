export const isObject = (item) => {
    return typeof item === 'object' && item !== null;
};
export const stripControlChars = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
export const decodeSuggestStyle = (suggestStyle) => suggestStyle >= 100 ? { color: suggestStyle % 10, trim: true } : { color: suggestStyle, trim: false };
export const isApiKeyFormat = (key) => typeof key === 'string' && /^[a-zA-Z0-9]+$/.test(key);
export const isFluidityLink = (item) => {
    if (!isObject(item)) {
        return false;
    }
    const { name, location } = item;
    return (typeof name === 'string' &&
        Boolean(name) &&
        typeof location === 'string' &&
        /^https?:\/\//i.test(location) &&
        stripControlChars(location) === location);
};
export const isFormattedData = (item) => {
    if (!isObject(item)) {
        return false;
    }
    const { suggestStyle, field, fieldType } = item;
    if (typeof suggestStyle !== 'number' || !Number.isFinite(suggestStyle)) {
        return false;
    }
    if (fieldType === 'LINK') {
        return isFluidityLink(field);
    }
    return (fieldType === 'DATE' || fieldType === 'STRING') && typeof field === 'string';
};
export const isFfluidityPacket = (item, forParams) => {
    if (!isObject(item)) {
        return false;
    }
    const { site, ts, description, plugin, formattedData, rawData } = item;
    return (typeof site === 'string' &&
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
        (typeof rawData === 'undefined' || typeof rawData === 'string' || rawData === null));
};
//# sourceMappingURL=types.js.map