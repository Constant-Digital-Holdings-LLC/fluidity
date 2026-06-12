import { RateBuckets, PULSE_WINDOWS, PULSE_BUCKETS } from '#@client/modules/pulse.js';
import { follow, FollowHandle } from './transport.js';
import { FilterSpec } from './filters.js';
import { renderParts, RenderOpts } from './renderLine.js';
import { TermCaps } from './caps.js';
import { parseKeys } from './keys.js';
import { initialState, addPacket, handleKey, UIState } from './uiModel.js';
import { composeFrame, drawFrame, enterScreen, leaveScreen } from './screen.js';

export interface InteractiveOpts {
    base: URL;
    insecure?: boolean;
    filters: FilterSpec;
    caps: TermCaps;
    showUrls?: boolean;
    historyLimit: number;
}

const REPAINT_MS = 50; //batching budget from SPEC.md §7 (the Pi console scrolls slowly)

export const runInteractive = (o: InteractiveOpts, onQuit: () => void): FollowHandle => {
    //OSC 8 sequences don't survive viewport clipping; underline still marks links
    const caps: TermCaps = { ...o.caps, hyperlinks: false };
    const render: RenderOpts = { caps, ...(o.showUrls !== undefined ? { showUrls: o.showUrls } : {}) };

    const out = process.stdout;
    const st: UIState = initialState(out.columns || 80, out.rows || 24, o.base.host, o.historyLimit);
    st.filters = o.filters;

    //rate strip: all windows accumulate in parallel (web parity); live
    //packets only - the history backfill would fake a burst
    const tracks = PULSE_WINDOWS.map(win => new RateBuckets(win.bucketMs, PULSE_BUCKETS, Date.now()));

    let dirty = true;
    let timer: NodeJS.Timeout | undefined;

    const repaint = (): void => {
        if (!dirty) return;
        dirty = false;
        st.rateSeries = tracks[st.pulseWindowIdx]?.series(Date.now()) ?? [];
        drawFrame(out, composeFrame(st, caps));
    };

    const scheduleRepaint = (): void => {
        dirty = true;
        timer ??= setTimeout(() => {
            timer = undefined;
            repaint();
        }, REPAINT_MS);
    };

    //quiet networks still need the strip to scroll and liveness to decay
    const slowTick = setInterval(() => scheduleRepaint(), 5000);

    const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        clearInterval(slowTick);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        leaveScreen(out);
    };

    const quit = (): void => {
        handle.stop();
        cleanup();
        onQuit();
    };

    //terminal must be restored even on crash (SPEC.md §8)
    process.on('exit', () => leaveScreen(out));

    enterScreen(out);

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', (chunk: Buffer) => {
        for (const key of parseKeys(chunk)) {
            handleKey(st, key);
            if (st.quit) {
                quit();
                return;
            }
        }
        scheduleRepaint();
    });

    out.on('resize', () => {
        st.cols = out.columns || 80;
        st.rows = out.rows || 24;
        scheduleRepaint();
    });

    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);

    const handle = follow(
        o.base,
        { ...(o.insecure !== undefined ? { insecure: o.insecure } : {}) },
        {
            onHistory: packets =>
                packets.slice(-o.historyLimit).forEach(p => {
                    addPacket(st, p, renderParts(p, render));
                    scheduleRepaint();
                }),
            onPacket: p => {
                const now = Date.now();
                tracks.forEach(t => t.note(now));
                addPacket(st, p, renderParts(p, render));
                scheduleRepaint();
            },
            onState: state => {
                st.conn = state;
                scheduleRepaint();
            }
        }
    );

    scheduleRepaint();
    return handle;
};
