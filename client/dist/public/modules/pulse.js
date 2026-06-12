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
    points(now) {
        const values = this.series(now);
        const headEnd = (Math.floor(now / this.bucketMs) + 1) * this.bucketMs;
        return values.map((v, i) => ({ t: headEnd - (values.length - 1 - i) * this.bucketMs, v }));
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
export const PULSE_BUCKETS = 60;
export const PULSE_WINDOWS = [
    { label: '5m', bucketMs: 5000 },
    { label: '1h', bucketMs: 60000 },
    { label: '24h', bucketMs: 1440000 }
];
export const restoreWindowIdx = (stored) => {
    const idx = PULSE_WINDOWS.findIndex(w => w.label === stored);
    return idx === -1 ? 0 : idx;
};
export const renderPulse = (canvas, pts, opts) => {
    var _a, _b;
    const ctx = canvas.getContext('2d');
    if (!ctx || pts.length < 2)
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
    const max = Math.max(1, ...pts.map(p => p.v));
    const pxPerMs = w / opts.windowMs;
    const xOf = (t) => w - (opts.now - t) * pxPerMs;
    const yOf = (v) => h - pad - (v / max) * (h - 2 * pad);
    const line = ctx.createLinearGradient(0, 0, w, 0);
    line.addColorStop(0, '#fe8dc6');
    line.addColorStop(1, '#fed1c7');
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(254, 141, 198, 0.22)');
    fill.addColorStop(1, 'rgba(254, 141, 198, 0.02)');
    ctx.beginPath();
    const first = pts[0];
    if (!first)
        return;
    ctx.moveTo(xOf(first.t), yOf(first.v));
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const cur = pts[i];
        if (!prev || !cur)
            continue;
        const mx = (xOf(prev.t) + xOf(cur.t)) / 2;
        const my = (yOf(prev.v) + yOf(cur.v)) / 2;
        ctx.quadraticCurveTo(xOf(prev.t), yOf(prev.v), mx, my);
    }
    const last = pts[pts.length - 1];
    if (last)
        ctx.lineTo(xOf(last.t), yOf(last.v));
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineTo(xOf((_b = last === null || last === void 0 ? void 0 : last.t) !== null && _b !== void 0 ? _b : opts.now), h);
    ctx.lineTo(xOf(first.t), h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 229, 255, 0.45)';
    ctx.fillText(opts.label, w - 5, 3);
};
export const drawSparkline = (canvas, series) => {
    const now = series.length;
    renderPulse(canvas, series.map((v, i) => ({ t: i + 1, v })), { now, windowMs: Math.max(1, series.length - 1), label: '' });
};
const STORAGE_KEY = 'fluidityPulseWindow';
export const startPulse = (canvas) => {
    var _a, _b, _c;
    const reduced = (_b = (_a = globalThis.matchMedia) === null || _a === void 0 ? void 0 : _a.call(globalThis, '(prefers-reduced-motion: reduce)').matches) !== null && _b !== void 0 ? _b : false;
    let stored;
    try {
        stored = (_c = globalThis.localStorage) === null || _c === void 0 ? void 0 : _c.getItem(STORAGE_KEY);
    }
    catch (_d) {
        stored = undefined;
    }
    let windowIdx = restoreWindowIdx(stored);
    const tracks = PULSE_WINDOWS.map(win => new RateBuckets(win.bucketMs, PULSE_BUCKETS, Date.now()));
    const draw = () => {
        const win = PULSE_WINDOWS[windowIdx];
        const track = tracks[windowIdx];
        if (!win || !track)
            return;
        renderPulse(canvas, track.points(Date.now()), {
            now: Date.now(),
            windowMs: win.bucketMs * (PULSE_BUCKETS - 2),
            label: win.label
        });
    };
    const describe = () => {
        var _a, _b;
        const win = PULSE_WINDOWS[windowIdx];
        canvas.setAttribute('aria-label', `Packet rate, last ${(_a = win === null || win === void 0 ? void 0 : win.label) !== null && _a !== void 0 ? _a : ''} - activate to change the time window`);
        canvas.title = `Packet rate (${(_b = win === null || win === void 0 ? void 0 : win.label) !== null && _b !== void 0 ? _b : ''}) - click to change window`;
    };
    const cycle = () => {
        var _a, _b, _c;
        windowIdx = (windowIdx + 1) % PULSE_WINDOWS.length;
        try {
            (_a = globalThis.localStorage) === null || _a === void 0 ? void 0 : _a.setItem(STORAGE_KEY, (_c = (_b = PULSE_WINDOWS[windowIdx]) === null || _b === void 0 ? void 0 : _b.label) !== null && _c !== void 0 ? _c : '5m');
        }
        catch (_d) {
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
    }
    else {
        const raf = globalThis.requestAnimationFrame;
        if (typeof raf === 'function') {
            const loop = () => {
                draw();
                raf(loop);
            };
            raf(loop);
        }
        else {
            setInterval(draw, 1000);
        }
    }
    draw();
    return {
        note: () => {
            const now = Date.now();
            tracks.forEach(t => t.note(now));
            if (reduced)
                draw();
        }
    };
};
//# sourceMappingURL=pulse.js.map