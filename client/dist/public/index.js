import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityUI } from './modules/ui.js';
import { startPulse } from './modules/pulse.js';
import { drainRenderQueue } from './modules/rxPump.js';
import { isFfluidityPacket } from '#@shared/types.js';
const conf = confFromDOM();
if (!conf)
    throw new Error('Missing Fluidity Client Config');
const log = fetchLogger(conf);
log.info(conf);
const rxQ = [];
let ui;
const RENDER_LIMITS = { budget: 48, cap: 256 };
const pulseCanvas = document.getElementById('pulse');
const pulse = pulseCanvas instanceof HTMLCanvasElement ? startPulse(pulseCanvas) : undefined;
const es = new EventSource('/SSE');
fetch('/FIFO')
    .then(response => response.json())
    .then(data => {
    if (Array.isArray(data) && data.length)
        if (data.every(d => isFfluidityPacket(d))) {
            ui = new FluidityUI(data);
        }
        else {
            log.warn('FIFO history contained a non-Fluidity packet; ignoring history');
        }
})
    .catch(err => {
    log.error(err);
});
es.onmessage = event => {
    if (typeof event.data === 'string') {
        const pd = JSON.parse(event.data);
        if (isFfluidityPacket(pd)) {
            rxQ.push(pd);
            pulse === null || pulse === void 0 ? void 0 : pulse.note();
        }
    }
};
const pumpOnce = () => {
    drainRenderQueue(rxQ, RENDER_LIMITS, ui instanceof FluidityUI ? (p) => ui.packetAdd(p) : null);
};
if (typeof requestAnimationFrame === 'function') {
    const frame = () => {
        pumpOnce();
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}
else {
    setInterval(pumpOnce, 100);
}
//# sourceMappingURL=index.js.map