import { Rng, mulberry32 } from './prng.js';
import { srsLineStream, radioFrame, portFrame, defaultSrsConfig } from './srsModel.js';
import type { TimedLine, SrsSimConfig } from './srsModel.js';
import { genericLines, genericBanner } from './data/genericLines.js';
export { mulberry32, srsLineStream, radioFrame, portFrame, defaultSrsConfig, genericLines, genericBanner };
export type { Rng, TimedLine, SrsSimConfig };
export interface SimProfile {
    readonly name: string;
    readonly banner?: string;
    readonly delimiter: string;
    source(rng: Rng): Generator<TimedLine, never, unknown>;
}
export declare function genericLineStream(rng: Rng): Generator<TimedLine, never, unknown>;
export declare const simProfileFromPath: (path: string) => SimProfile | undefined;
export interface FeederOptions {
    seed?: number;
}
export interface FeederHandle {
    stop(): void;
}
export declare const startFeeder: (profile: SimProfile, write: (chunk: string) => void, options?: FeederOptions) => FeederHandle;
//# sourceMappingURL=index.d.ts.map