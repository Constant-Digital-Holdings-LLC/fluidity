export class RateBuckets {
    constructor(bucketMs, size, now) {
        this.bucketMs = bucketMs;
        this.size = size;
        this.headIdx = 0;
        this.counts = new Array(size).fill(0);
        this.headBucket = Math.floor(now / bucketMs);
    }
    advance(now) {
        const bucket = Math.floor(now / this.bucketMs);
        let steps = bucket - this.headBucket;
        if (steps <= 0)
            return;
        if (steps >= this.size) {
            this.counts.fill(0);
            this.headIdx = 0;
        }
        else {
            while (steps-- > 0) {
                this.headIdx = (this.headIdx + 1) % this.size;
                this.counts[this.headIdx] = 0;
            }
        }
        this.headBucket = bucket;
    }
    note(now) {
        var _a;
        this.advance(now);
        this.counts[this.headIdx] = ((_a = this.counts[this.headIdx]) !== null && _a !== void 0 ? _a : 0) + 1;
    }
    series(now) {
        var _a;
        this.advance(now);
        const out = [];
        for (let i = 1; i <= this.size; i++) {
            out.push((_a = this.counts[(this.headIdx + i) % this.size]) !== null && _a !== void 0 ? _a : 0);
        }
        return out;
    }
}
export const FRESH_MS = 150000;
export const RECENT_MS = 450000;
export const livenessOf = (lastSeenMs, nowMs) => {
    const age = nowMs - lastSeenMs;
    if (age <= FRESH_MS)
        return 'fresh';
    if (age <= RECENT_MS)
        return 'recent';
    return 'stale';
};
export const drawSparkline = (canvas, series) => {
    var _a;
    const ctx = canvas.getContext('2d');
    if (!ctx || series.length < 2)
        return;
    const dpr = (_a = globalThis.devicePixelRatio) !== null && _a !== void 0 ? _a : 1;
    const w = canvas.clientWidth || 220;
    const h = canvas.clientHeight || 36;
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = 2.5;
    const max = Math.max(1, ...series);
    const stepX = w / (series.length - 1);
    const yOf = (v) => h - pad - (v / max) * (h - 2 * pad);
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
export const startPulse = (canvas) => {
    var _a, _b;
    const reduced = (_b = (_a = globalThis.matchMedia) === null || _a === void 0 ? void 0 : _a.call(globalThis, '(prefers-reduced-motion: reduce)').matches) !== null && _b !== void 0 ? _b : false;
    const buckets = new RateBuckets(5000, 36, Date.now());
    const draw = () => drawSparkline(canvas, buckets.series(Date.now()));
    setInterval(draw, reduced ? 5000 : 1000);
    draw();
    return {
        note: () => {
            buckets.note(Date.now());
            draw();
        }
    };
};
//# sourceMappingURL=pulse.js.map