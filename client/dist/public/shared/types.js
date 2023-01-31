export const isFfluidityPacket = (obj, omitFormattedData) => {
    const { site, description, plugin, formattedData, rawData } = obj !== null && obj !== void 0 ? obj : {};
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