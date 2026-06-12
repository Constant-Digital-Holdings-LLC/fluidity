//console-safe packet-rate strip: the web sparkline's TUI counterpart.
//CP437 (the Pi console font) lacks braille bars but has the shade ramp,
//so rate is rendered as cell density. Pure functions; painting is the
//caller's job.

//space = silence; the ramp carries four levels of activity
const RAMP = [' ', '░', '▒', '▓', '█'] as const; // ░ ▒ ▓ █

//max-pooling preserves spikes when squeezing 60 buckets into fewer cells
export const downsample = (series: number[], cells: number): number[] => {
    if (cells <= 0) return [];
    if (series.length <= cells) return [...series];

    const out: number[] = [];
    for (let c = 0; c < cells; c++) {
        const start = Math.floor((c * series.length) / cells);
        const end = Math.max(start + 1, Math.floor(((c + 1) * series.length) / cells));
        out.push(Math.max(...series.slice(start, end)));
    }
    return out;
};

export const stripOf = (series: number[], cells: number): string => {
    const values = downsample(series, cells);
    const max = Math.max(1, ...values);

    return values
        .map(v => {
            if (v <= 0) return RAMP[0];
            const idx = 1 + Math.min(RAMP.length - 2, Math.floor((v / max) * (RAMP.length - 2)));
            return RAMP[idx];
        })
        .join('');
};
