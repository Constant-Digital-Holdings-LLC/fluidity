import { isFfluidityPacket } from '#@shared/types.js';
import { PacketFIFO } from './packetFIFO.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
const log = fetchLogger(await confFromFS());
const fifo = new PacketFIFO(500);
export const GET = (req, res) => {
    res.set('Connection', 'close');
    return res.end().status(200).json(fifo.toArray());
};
export const POST = (req, res) => {
    if (req?.body) {
        if (isFfluidityPacket(req.body)) {
            fifo.push(req.body);
            res.end();
        }
        else {
            log.warn(`No Fluidity Packet in Req Body: ${JSON.stringify(req.body)}`);
        }
    }
    else {
        log.warn('Request Body Empty');
    }
};
