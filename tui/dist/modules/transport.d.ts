import { FluidityPacket } from '#@shared/types.js';
export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'stopped';
export interface FollowOpts {
    insecure?: boolean;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
}
export interface FollowEvents {
    onHistory: (packets: FluidityPacket[]) => void;
    onPacket: (p: FluidityPacket) => void;
    onState?: (state: ConnState, detail?: string) => void;
}
export interface FollowHandle {
    stop(): void;
}
export declare const shouldVerifyTLS: (url: URL, insecure?: boolean) => boolean;
export declare const fetchHistory: (base: URL, insecure?: boolean) => Promise<FluidityPacket[]>;
export declare const follow: (base: URL, opts: FollowOpts, events: FollowEvents) => FollowHandle;
//# sourceMappingURL=transport.d.ts.map