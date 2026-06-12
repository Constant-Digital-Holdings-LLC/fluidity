import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityUI } from './modules/ui.js';
import { startPulse } from './modules/pulse.js';
import { drainRenderQueue, PumpLimits } from './modules/rxPump.js';
import { FluidityPacket, isFfluidityPacket } from '#@shared/types.js';

const conf = confFromDOM();
if (!conf) throw new Error('Missing Fluidity Client Config');
const log = fetchLogger(conf);
log.info(conf);

const rxQ: FluidityPacket[] = [];
let ui: FluidityUI;

//render at most ~48 lines/frame (~2900/s at 60fps) and keep at most ~256
//queued; a heavier live rate sheds its oldest backlog from the render path so
//the main thread never stalls. Nobody reads 6000 lines/sec - the stream stays
//a smooth, bounded tail and the sparkline still reports the true arrival rate.
const RENDER_LIMITS: PumpLimits = { budget: 48, cap: 256 };

//header sparkline: counts live SSE arrivals only (history would fake a burst)
const pulseCanvas = document.getElementById('pulse');
const pulse = pulseCanvas instanceof HTMLCanvasElement ? startPulse(pulseCanvas) : undefined;

const es = new EventSource('/SSE');

//EventSource auto-reconnects after a drop. The first 'open' is the initial
//connection (the /FIFO fetch below sets the baseline); a later 'open' is a
//reconnect, after which the server may have restarted and reset its seq
//counter - so re-fetch and re-baseline the demarcation, or the dashboard
//would silently drop every new packet (lower seq) until a manual reload.
let sseConnected = false;
es.addEventListener('open', () => {
    if (!sseConnected) {
        sseConnected = true;
        return;
    }
    log.info('SSE reconnected; re-baselining in case the server restarted');
    fetch('/FIFO')
        .then(response => response.json())
        .then(data => {
            if (Array.isArray(data) && data.every(d => isFfluidityPacket(d)) && ui instanceof FluidityUI) {
                ui.resync(data); //empty array (fresh FIFO) is fine - baselines to 0
            }
        })
        .catch(err => log.error(err));
});

fetch('/FIFO')
    .then(response => response.json())
    .then(data => {
        //note: `data.every(() => isFfluidityPacket)` (a thunk returning the
        //guard) always passed - the guard was never actually called. Invoke it.
        if (Array.isArray(data) && data.length)
            if (data.every(d => isFfluidityPacket(d))) {
                //the guard above narrows `data` to FluidityPacket[] - no cast
                ui = new FluidityUI(data);
            } else {
                log.warn('FIFO history contained a non-Fluidity packet; ignoring history');
            }
    })
    .catch(err => {
        log.error(err);
    });

//receipt is cheap: parse, count for the sparkline, enqueue. All DOM work
//happens in the frame pump below, off the SSE callback's hot path.
es.onmessage = event => {
    if (typeof event.data === 'string') {
        const pd = JSON.parse(event.data) as unknown;
        if (isFfluidityPacket(pd)) {
            rxQ.push(pd);
            pulse?.note(); //every arrival counts toward the rate, rendered or not
        }
    }
};

//frame-paced render pump: bounded DOM work per tick, backlog shed under flood.
//rAF where available; a timer fallback keeps tests and headless contexts sane.
const pumpOnce = (): void => {
    drainRenderQueue(rxQ, RENDER_LIMITS, ui instanceof FluidityUI ? (p): void => ui.packetAdd(p) : null);
};

if (typeof requestAnimationFrame === 'function') {
    const frame = (): void => {
        pumpOnce();
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
} else {
    setInterval(pumpOnce, 100);
}
