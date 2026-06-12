const RAMP = [' ', '░', '▒', '▓', '█'];
export const downsample = (series, cells) => {
    if (cells <= 0)
        return [];
    if (series.length <= cells)
        return [...series];
    const out = [];
    for (let c = 0; c < cells; c++) {
        const start = Math.floor((c * series.length) / cells);
        const end = Math.max(start + 1, Math.floor(((c + 1) * series.length) / cells));
        out.push(Math.max(...series.slice(start, end)));
    }
    return out;
};
export const stripOf = (series, cells) => {
    const values = downsample(series, cells);
    const max = Math.max(1, ...values);
    return values
        .map(v => {
        if (v <= 0)
            return RAMP[0];
        const idx = 1 + Math.min(RAMP.length - 2, Math.floor((v / max) * (RAMP.length - 2)));
        return RAMP[idx];
    })
        .join('');
};
//# sourceMappingURL=rateStrip.js.map