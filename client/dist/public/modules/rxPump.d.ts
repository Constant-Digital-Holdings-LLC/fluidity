export interface PumpLimits {
    budget: number;
    cap: number;
}
export interface DrainResult {
    rendered: number;
    dropped: number;
}
export declare const drainRenderQueue: <T>(queue: T[], limits: PumpLimits, render: ((item: T) => void) | null) => DrainResult;
//# sourceMappingURL=rxPump.d.ts.map