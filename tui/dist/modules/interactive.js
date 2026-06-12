import { RateBuckets, PULSE_WINDOWS, PULSE_BUCKETS } from '#@client/modules/pulse.js';
import { follow } from './transport.js';
import { renderParts } from './renderLine.js';
import { parseKeys } from './keys.js';
import { initialState, addPacket, handleKey } from './uiModel.js';
import { composeFrame, drawFrame, enterScreen, leaveScreen } from './screen.js';
const REPAINT_MS = 50;
export const runInteractive = (o, onQuit) => {
    const caps = { ...o.caps, hyperlinks: false };
    const render = { caps, ...(o.showUrls !== undefined ? { showUrls: o.showUrls } : {}) };
    const out = process.stdout;
    const st = initialState(out.columns || 80, out.rows || 24, o.base.host, o.historyLimit);
    st.filters = o.filters;
    const tracks = PULSE_WINDOWS.map(win => new RateBuckets(win.bucketMs, PULSE_BUCKETS, Date.now()));
    let dirty = true;
    let timer;
    const repaint = () => {
        if (!dirty)
            return;
        dirty = false;
        st.rateSeries = tracks[st.pulseWindowIdx]?.series(Date.now()) ?? [];
        drawFrame(out, composeFrame(st, caps));
    };
    const scheduleRepaint = () => {
        dirty = true;
        timer ??= setTimeout(() => {
            timer = undefined;
            repaint();
        }, REPAINT_MS);
    };
    const slowTick = setInterval(() => scheduleRepaint(), 5000);
    const cleanup = () => {
        if (timer)
            clearTimeout(timer);
        clearInterval(slowTick);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        leaveScreen(out);
    };
    const quit = () => {
        handle.stop();
        cleanup();
        onQuit();
    };
    process.on('exit', () => leaveScreen(out));
    enterScreen(out);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', (chunk) => {
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
    const handle = follow(o.base, { ...(o.insecure !== undefined ? { insecure: o.insecure } : {}) }, {
        onHistory: packets => packets.slice(-o.historyLimit).forEach(p => {
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
    });
    scheduleRepaint();
    return handle;
};
//# sourceMappingURL=interactive.js.map