//live-activity instrumentation: packet-rate sparkline + site liveness.
//pure logic (RateBuckets, livenessOf, window selection) is separated from
//canvas drawing so it runs under node/jsdom tests; nothing here touches the
//filtering engine.

import { HEARTBEAT_SEC } from '#@shared/types.js';

//ring buffer of per-interval packet counts
export class RateBuckets {
    private counts: number[];
    private headIdx = 0;
    private headBucket: number;

    constructor(
        private bucketMs: number,
        private size: number,
        now: number
    ) {
        this.counts = new Array<number>(size).fill(0);
        this.headBucket = Math.floor(now / bucketMs);
    }

    private advance(now: number): void {
        const bucket = Math.floor(now / this.bucketMs);
        let steps = bucket - this.headBucket;
        if (steps <= 0) return;

        if (steps >= this.size) {
            this.counts.fill(0);
            this.headIdx = 0;
        } else {
            while (steps-- > 0) {
                this.headIdx = (this.headIdx + 1) % this.size;
                this.counts[this.headIdx] = 0;
            }
        }
        this.headBucket = bucket;
    }

    note(now: number): void {
        this.advance(now);
        this.counts[this.headIdx] = (this.counts[this.headIdx] ?? 0) + 1;
    }

    //oldest -> newest, always `size` entries
    series(now: number): number[] {
        this.advance(now);
        const out: number[] = [];
        for (let i = 1; i <= this.size; i++) {
            out.push(this.counts[(this.headIdx + i) % this.size] ?? 0);
        }
        return out;
    }

    //series points stamped with each bucket's end time (newest may be in the
    //future while its bucket is still filling - the renderer clips it at the
    //right edge, which is what makes the line glide instead of snap)
    points(now: number): PulsePoint[] {
        const values = this.series(now);
        const headEnd = (Math.floor(now / this.bucketMs) + 1) * this.bucketMs;
        return values.map((v, i) => ({ t: headEnd - (values.length - 1 - i) * this.bucketMs, v }));
    }
}

//Every site beats at least every HEARTBEAT_SEC (the agent's internal vRep, plus
//any faster data source like the SRS 100s frame). Derive the windows from it so
//they track the heartbeat: fresh allows ~one missed beat plus slack, recent a
//few, beyond that the site is quiet. Change the cadence in one place
//(HEARTBEAT_SEC) and these move with it.
export const FRESH_MS = HEARTBEAT_SEC * 1500; //1.5 beats
export const RECENT_MS = HEARTBEAT_SEC * 4500; //4.5 beats

export type Liveness = 'fresh' | 'recent' | 'stale';

export const livenessOf = (lastSeenMs: number, nowMs: number): Liveness => {
    const age = nowMs - lastSeenMs;
    if (age <= FRESH_MS) return 'fresh';
    if (age <= RECENT_MS) return 'recent';
    return 'stale';
};

//selectable rate windows, cycled by clicking the sparkline
export const PULSE_BUCKETS = 60;

export interface PulseWindow {
    label: string;
    bucketMs: number;
}

export const PULSE_WINDOWS: readonly PulseWindow[] = [
    { label: '5m', bucketMs: 5_000 },
    { label: '1h', bucketMs: 60_000 },
    { label: '24h', bucketMs: 1_440_000 }
];

export const restoreWindowIdx = (stored: unknown): number => {
    const idx = PULSE_WINDOWS.findIndex(w => w.label === stored);
    return idx === -1 ? 0 : idx;
};

export interface PulsePoint {
    t: number;
    v: number;
}

interface RenderOpts {
    now: number;
    windowMs: number;
    label: string;
}

//time-based renderer: x is derived from each point's timestamp relative to
//`now`, so successive frames scroll the waveform continuously leftward.
//midpoint quadratic smoothing turns the polyline into a gentle spline.
export const renderPulse = (canvas: HTMLCanvasElement, pts: PulsePoint[], opts: RenderOpts): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx || pts.length < 2) return;

    const dpr = globalThis.devicePixelRatio ?? 1;
    const w = canvas.clientWidth || 220;
    const h = canvas.clientHeight || 36;

    //resizing a canvas clears it; only do so when the size truly changed
    //(layout shifts elsewhere must not make the graph visibly re-render)
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = 2.5;
    const max = Math.max(1, ...pts.map(p => p.v));
    const pxPerMs = w / opts.windowMs;
    const xOf = (t: number): number => w - (opts.now - t) * pxPerMs;
    const yOf = (v: number): number => h - pad - (v / max) * (h - 2 * pad);

    const line = ctx.createLinearGradient(0, 0, w, 0);
    line.addColorStop(0, '#fe8dc6');
    line.addColorStop(1, '#fed1c7');

    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(254, 141, 198, 0.22)');
    fill.addColorStop(1, 'rgba(254, 141, 198, 0.02)');

    ctx.beginPath();
    const first = pts[0];
    if (!first) return;
    ctx.moveTo(xOf(first.t), yOf(first.v));
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const cur = pts[i];
        if (!prev || !cur) continue;
        const mx = (xOf(prev.t) + xOf(cur.t)) / 2;
        const my = (yOf(prev.v) + yOf(cur.v)) / 2;
        ctx.quadraticCurveTo(xOf(prev.t), yOf(prev.v), mx, my);
    }
    const last = pts[pts.length - 1];
    if (last) ctx.lineTo(xOf(last.t), yOf(last.v));

    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.lineTo(xOf(last?.t ?? opts.now), h);
    ctx.lineTo(xOf(first.t), h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    //active window label, top-right corner
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 229, 255, 0.45)';
    ctx.fillText(opts.label, w - 5, 3);
};

//compatibility/test surface: render an evenly spaced series
export const drawSparkline = (canvas: HTMLCanvasElement, series: number[]): void => {
    const now = series.length;
    renderPulse(
        canvas,
        series.map((v, i) => ({ t: i + 1, v })),
        { now, windowMs: Math.max(1, series.length - 1), label: '' }
    );
};

export interface PulseHandle {
    note: () => void;
}

const STORAGE_KEY = 'fluidityPulseWindow';

export const startPulse = (canvas: HTMLCanvasElement): PulseHandle => {
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let stored: unknown;
    try {
        stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    } catch {
        stored = undefined;
    }
    let windowIdx = restoreWindowIdx(stored);

    //all windows accumulate in parallel so switching never loses history
    const tracks = PULSE_WINDOWS.map(win => new RateBuckets(win.bucketMs, PULSE_BUCKETS, Date.now()));

    const draw = (): void => {
        const win = PULSE_WINDOWS[windowIdx];
        const track = tracks[windowIdx];
        if (!win || !track) return;
        renderPulse(canvas, track.points(Date.now()), {
            now: Date.now(),
            windowMs: win.bucketMs * (PULSE_BUCKETS - 2),
            label: win.label
        });
    };

    const describe = (): void => {
        const win = PULSE_WINDOWS[windowIdx];
        canvas.setAttribute('aria-label', `Packet rate, last ${win?.label ?? ''} - activate to change the time window`);
        canvas.title = `Packet rate (${win?.label ?? ''}) - click to change window`;
    };

    const cycle = (): void => {
        windowIdx = (windowIdx + 1) % PULSE_WINDOWS.length;
        try {
            globalThis.localStorage?.setItem(STORAGE_KEY, PULSE_WINDOWS[windowIdx]?.label ?? '5m');
        } catch {
            //private mode etc - the choice just won't persist
        }
        describe();
        draw();
    };

    canvas.setAttribute('role', 'button');
    canvas.tabIndex = 0;
    describe();
    canvas.addEventListener('click', cycle);
    canvas.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            cycle();
        }
    });

    if (reduced) {
        setInterval(draw, 5000);
    } else {
        const raf = globalThis.requestAnimationFrame;
        if (typeof raf === 'function') {
            const loop = (): void => {
                draw();
                raf(loop);
            };
            raf(loop);
        } else {
            setInterval(draw, 1000);
        }
    }
    draw();

    return {
        note: (): void => {
            const now = Date.now();
            tracks.forEach(t => t.note(now));
            if (reduced) draw();
        }
    };
};
