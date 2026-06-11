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
}
export declare const FRESH_MS = 150000;
export declare const RECENT_MS = 450000;
export type Liveness = 'fresh' | 'recent' | 'stale';
export declare const livenessOf: (lastSeenMs: number, nowMs: number) => Liveness;
export declare const drawSparkline: (canvas: HTMLCanvasElement, series: number[]) => void;
export interface PulseHandle {
    note: () => void;
}
export declare const startPulse: (canvas: HTMLCanvasElement) => PulseHandle;
//# sourceMappingURL=pulse.d.ts.map