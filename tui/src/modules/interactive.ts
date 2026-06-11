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

    let dirty = true;
    let timer: NodeJS.Timeout | undefined;

    const repaint = (): void => {
        if (!dirty) return;
        dirty = false;
        drawFrame(out, composeFrame(st, caps));
    };

    const scheduleRepaint = (): void => {
        dirty = true;
        timer ??= setTimeout(() => {
            timer = undefined;
            repaint();
        }, REPAINT_MS);
    };

    const cleanup = (): void => {
        if (timer) clearTimeout(timer);
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
