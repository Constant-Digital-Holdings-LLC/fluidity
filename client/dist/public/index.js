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
        if (Array.isArray(data) && ui instanceof FluidityUI) {
            ui.resync(data.filter((d) => isFfluidityPacket(d)));
        }
    })
        .catch(err => log.error(err));
});
fetch('/FIFO')
    .then(response => response.json())
    .then(data => {
    if (Array.isArray(data)) {
        const good = data.filter((d) => isFfluidityPacket(d));
        if (good.length !== data.length) {
            log.warn('FIFO history contained non-Fluidity packets; rendering the valid subset');
        }
        ui = new FluidityUI(good);
    }
})
    .catch(err => {
    log.error(err);
});
es.onmessage = event => {
    if (typeof event.data === 'string') {
        let pd;
        try {
            pd = JSON.parse(event.data);
        }
        catch (_a) {
            log.warn('dropping malformed SSE frame');
            return;
        }
        if (isFfluidityPacket(pd)) {
            rxQ.push(pd);
            pulse === null || pulse === void 0 ? void 0 : pulse.note();
        }
    }
};
const pumpOnce = () => {
    try {
        const { rendered } = drainRenderQueue(rxQ, RENDER_LIMITS, ui instanceof FluidityUI ? (p) => ui.packetAdd(p) : null);
        if (rendered > 0 && ui instanceof FluidityUI) {
            ui.flushFrame();
        }
    }
    catch (err) {
        log.error(err);
    }
};
if (typeof requestAnimationFrame === 'function') {
    const frame = () => {
        requestAnimationFrame(frame);
        pumpOnce();
    };
    requestAnimationFrame(frame);
}
else {
    setInterval(pumpOnce, 100);
}
//# sourceMappingURL=index.js.map