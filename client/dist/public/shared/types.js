export const isObject = (value) => {
    return typeof value === 'object' && value !== null;
};
export const isFfluidityPacket = (item, omitFormattedData) => {
    if (!isObject(item)) {
        return false;
    }
    const { site, description, plugin, formattedData, rawData } = item;
    return (typeof site === 'string' &&
        Boolean(site) &&
        typeof description === 'string' &&
        Boolean(description) &&
        typeof plugin === 'string' &&
        Boolean(plugin) &&
        (omitFormattedData ? true : Array.isArray(formattedData)) &&
        (typeof rawData === 'undefined' || typeof rawData === 'string' || rawData === null));
};
//# sourceMappingURL=types.js.map