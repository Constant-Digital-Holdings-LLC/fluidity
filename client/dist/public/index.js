import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityUI } from './modules/ui.js';
import { isFfluidityPacket } from '#@shared/types.js';
const conf = confFromDOM();
if (!conf)
    throw new Error('Missing Fluidity Client Config');
const log = fetchLogger(conf);
log.debug(conf);
const rxQ = [];
let ui;
const es = new EventSource('/SSE');
window.addEventListener('DOMContentLoaded', () => {
    var _a;
    log.info('DOM Content Loaded');
    (_a = document.getElementById('current-data')) === null || _a === void 0 ? void 0 : _a.scroll({
        top: 0,
        behavior: 'smooth'
    });
});
fetch('/FIFO')
    .then(response => response.json())
    .then(data => {
    if (Array.isArray(data) && data.length)
        if (data.every(() => isFfluidityPacket)) {
            ui = new FluidityUI(data);
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
        }
    }
    if (ui instanceof FluidityUI) {
        rxQ.forEach((item, index, object) => {
            ui.packetAdd(item);
            object.splice(index, 1);
        });
    }
    else {
        log.warn('historical data not yet loaded, queuing realtime rx');
    }
};
//# sourceMappingURL=index.js.map