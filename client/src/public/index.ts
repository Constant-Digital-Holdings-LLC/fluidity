import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityUI } from './modules/ui.js';
import { FluidityPacket, isFfluidityPacket } from '#@shared/types.js';

const conf = confFromDOM();
if (!conf) throw new Error('Missing Fluidity Client Config');
const log = fetchLogger(conf);
log.info(conf);

const rxQ: FluidityPacket[] = [];
let ui: FluidityUI;

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

es.onmessage = event => {
    if (typeof event.data === 'string') {
        const pd = JSON.parse(event.data) as unknown;
        if (isFfluidityPacket(pd)) {
            rxQ.push(pd);
        }
    }

    if (ui instanceof FluidityUI) {
        rxQ.forEach((item, index, object) => {
            ui.packetAdd(item);
            object.splice(index, 1);
        });
    } else {
        log.warn('historical data not yet loaded, queuing realtime rx');
    }
};
