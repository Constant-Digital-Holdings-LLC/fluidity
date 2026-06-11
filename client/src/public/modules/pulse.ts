//live-activity instrumentation: packet-rate sparkline + site liveness.
//pure logic (RateBuckets, livenessOf) is separated from canvas drawing so it
//runs under node/jsdom tests; nothing here touches the filtering engine.

//ring buffer of per-interval packet counts
export class RateBuckets {
    private counts: number[];
    private headIdx = 0;
    private headBucket: number;

    constructor(private bucketMs: number, private size: number, now: number) {
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
}

//sites emit at least the 100s port-state heartbeat, so: fresh allows one
//missed beat plus slack, recent allows a few, beyond that the site is quiet
export const FRESH_MS = 150_000;
export const RECENT_MS = 450_000;

export type Liveness = 'fresh' | 'recent' | 'stale';

export const livenessOf = (lastSeenMs: number, nowMs: number): Liveness => {
    const age = nowMs - lastSeenMs;
    if (age <= FRESH_MS) return 'fresh';
    if (age <= RECENT_MS) return 'recent';
    return 'stale';
};

//sparkline in the logo's accent gradient (pink -> peach); no-ops where
//canvas isn't available (jsdom)
export const drawSparkline = (canvas: HTMLCanvasElement, series: number[]): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx || series.length < 2) return;

    const dpr = globalThis.devicePixelRatio ?? 1;
    const w = canvas.clientWidth || 220;
    const h = canvas.clientHeight || 36;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = 2.5;
    const max = Math.max(1, ...series);
    const stepX = w / (series.length - 1);
    const yOf = (v: number): number => h - pad - (v / max) * (h - 2 * pad);

    const line = ctx.createLinearGradient(0, 0, w, 0);
    line.addColorStop(0, '#fe8dc6');
    line.addColorStop(1, '#fed1c7');

    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(254, 141, 198, 0.22)');
    fill.addColorStop(1, 'rgba(254, 141, 198, 0.02)');

    ctx.beginPath();
    series.forEach((v, i) => {
        const x = i * stepX;
        const y = yOf(v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
};

export interface PulseHandle {
    note: () => void;
}

//5s buckets x 36 = the last three minutes of traffic
export const startPulse = (canvas: HTMLCanvasElement): PulseHandle => {
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const buckets = new RateBuckets(5000, 36, Date.now());
    const draw = (): void => drawSparkline(canvas, buckets.series(Date.now()));

    setInterval(draw, reduced ? 5000 : 1000);
    draw();

    return {
        note: (): void => {
            buckets.note(Date.now());
            draw();
        }
    };
};
