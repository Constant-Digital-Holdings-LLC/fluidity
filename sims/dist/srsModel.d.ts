import { Rng } from './prng.js';
export interface TimedLine {
    afterMs: number;
    line: string;
}
export interface SrsSimConfig {
    linked: number;
    loopback: number;
    interfaced: number;
    activePorts: number[];
    heartbeatMs: number;
    rcvActProbability: number;
    keyMinMs: number;
    keyMaxMs: number;
    overGapMinMs: number;
    overGapMaxMs: number;
    oversMin: number;
    oversMax: number;
    idleMinMs: number;
    idleMaxMs: number;
}
export declare const defaultSrsConfig: SrsSimConfig;
export declare const radioFrame: (cor: number, pl: number, rcv: number, dtmf: number, ptt: number) => string;
export declare const portFrame: (c: Pick<SrsSimConfig, "linked" | "loopback" | "interfaced">) => string;
export declare function srsLineStream(rng: Rng, config?: Partial<SrsSimConfig>): Generator<TimedLine, never, unknown>;
//# sourceMappingURL=srsModel.d.ts.map