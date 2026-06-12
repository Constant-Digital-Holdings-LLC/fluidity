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

fetch('/FIFO')
    .then(response => response.json())
    .then(data => {
        if (Array.isArray(data) && data.length)
            if (data.every(() => isFfluidityPacket)) {
                //initialize with historical data
                ui = new FluidityUI(data as FluidityPacket[]);
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
