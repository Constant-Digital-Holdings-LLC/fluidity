import { mulberry32 } from './prng.js';
import { srsLineStream, radioFrame, portFrame, defaultSrsConfig } from './srsModel.js';
import { genericLines, genericBanner } from './data/genericLines.js';
export { mulberry32, srsLineStream, radioFrame, portFrame, defaultSrsConfig, genericLines, genericBanner };
export function* genericLineStream(rng) {
    for (;;) {
        yield {
            afterMs: 250 + Math.floor(rng() * 9750),
            line: genericLines[Math.floor(rng() * genericLines.length)] ?? ''
        };
    }
}
const profiles = new Map([
    [
        'srs',
        {
            name: 'srs',
            delimiter: '\r\n',
            source: (rng) => srsLineStream(rng)
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
export const simProfileFromPath = (path) => {
    const match = path.match(/^sim:\/\/([a-zA-Z0-9-]+)$/);
    return match?.[1] ? profiles.get(match[1].toLowerCase()) : undefined;
};
export const startFeeder = (profile, write, options) => {
    const seed = options?.seed ?? Math.floor(Math.random() * 0xffffffff);
    const source = profile.source(mulberry32(seed));
    let stopped = false;
    let timer;
    const scheduleNext = () => {
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
        stop() {
            stopped = true;
            if (timer) {
                clearTimeout(timer);
            }
        }
    };
};
//# sourceMappingURL=index.js.map