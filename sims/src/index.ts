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

//cadence matches the original arduino sketch: delay(random(250, 10000))
export function* genericLineStream(rng: Rng): Generator<TimedLine, never, unknown> {
    for (;;) {
        yield {
            afterMs: 250 + Math.floor(rng() * 9750),
            line: genericLines[Math.floor(rng() * genericLines.length)] ?? ''
        };
    }
}

const profiles: ReadonlyMap<string, SimProfile> = new Map([
    [
        'srs',
        {
            //real controllers emit no banner - telemetry frames only
            name: 'srs',
            delimiter: '\r\n',
            source: (rng: Rng) => srsLineStream(rng)
        }
    ],
    [
        'generic',
        {
            name: 'generic',
            banner: genericBanner,
            delimiter: '\r\n',
            source: genericLineStream
        }
    ]
]);

export const simProfileFromPath = (path: string): SimProfile | undefined => {
    const match = path.match(/^sim:\/\/([a-zA-Z0-9-]+)$/);
    return match?.[1] ? profiles.get(match[1].toLowerCase()) : undefined;
};

export interface FeederOptions {
    seed?: number;
}

export interface FeederHandle {
    stop(): void;
}

export const startFeeder = (
    profile: SimProfile,
    write: (chunk: string) => void,
    options?: FeederOptions
): FeederHandle => {
    const seed = options?.seed ?? Math.floor(Math.random() * 0xffffffff);
    const source = profile.source(mulberry32(seed));

    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const scheduleNext = (): void => {
        if (stopped) {
            return;
        }

        const { afterMs, line } = source.next().value;

        timer = setTimeout(() => {
            if (stopped) {
                return;
            }
            write(line + profile.delimiter);
            scheduleNext();
        }, afterMs);
    };

    if (profile.banner) {
        write(profile.banner + profile.delimiter);
    }
    scheduleNext();

    return {
        stop(): void {
            stopped = true;
            if (timer) {
                clearTimeout(timer);
            }
        }
    };
};
