export declare class RateBuckets {
    private bucketMs;
    private size;
    private counts;
    private headIdx;
    private headBucket;
    constructor(bucketMs: number, size: number, now: number);
    private advance;
    note(now: number): void;
    series(now: number): number[];
    points(now: number): PulsePoint[];
}
export declare const FRESH_MS = 150000;
export declare const RECENT_MS = 450000;
export type Liveness = 'fresh' | 'recent' | 'stale';
export declare const livenessOf: (lastSeenMs: number, nowMs: number) => Liveness;
export declare const PULSE_BUCKETS = 60;
export interface PulseWindow {
    label: string;
    bucketMs: number;
}
export declare const PULSE_WINDOWS: readonly PulseWindow[];
export declare const restoreWindowIdx: (stored: unknown) => number;
export interface PulsePoint {
    t: number;
    v: number;
}
interface RenderOpts {
    now: number;
    windowMs: number;
    label: string;
}
export declare const renderPulse: (canvas: HTMLCanvasElement, pts: PulsePoint[], opts: RenderOpts) => void;
export declare const drawSparkline: (canvas: HTMLCanvasElement, series: number[]) => void;
export interface PulseHandle {
    note: () => void;
}
export declare const startPulse: (canvas: HTMLCanvasElement) => PulseHandle;
export {};
//# sourceMappingURL=pulse.d.ts.map