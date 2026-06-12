export type StressCategory = 'valid' | 'garbage' | 'tampered' | 'unsigned';
export interface UdpStressOptions {
    host?: string;
    port?: number;
    rate?: number;
    durationSec?: number;
    devices?: number;
    mix?: Partial<Record<StressCategory, number>>;
    secret?: string;
    seed?: number;
}
export interface StressReport {
    totalSent: number;
    perCategory: Record<StressCategory, number>;
    sendErrors: number;
    elapsedMs: number;
    achievedPps: number;
    targetPps: number;
    devices: number;
}
export interface StressHandle {
    done: Promise<StressReport>;
    stop(): void;
}
export declare const CATEGORIES: StressCategory[];
export declare const parseMix: (spec: string) => Partial<Record<StressCategory, number>>;
export declare const runUdpStress: (options?: UdpStressOptions) => StressHandle;
//# sourceMappingURL=udpStressEmitter.d.ts.map