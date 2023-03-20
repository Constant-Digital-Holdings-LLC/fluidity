import { isFfluidityPacket } from '#@shared/types.js';
import { PacketFIFO } from './packetFIFO.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import SSE_pkg from 'express-sse-ts';
const conf = await confFromFS();
const { default: ServerSideEvents } = SSE_pkg;
const sse = new ServerSideEvents();
const log = fetchLogger(conf);
const fifo = new PacketFIFO(conf?.maxServerHistory ?? 1000);
export const SSE = (req, res, next) => {
    return sse.init(req, res, next);
};
export const GET = (req, res) => {
    return res.status(200).json(fifo.toArray());
};
export const POST = (req, res) => {
    log.debug(`in FIFO Controller, CLIENT headers on POST: ${JSON.stringify(req.headers)}`);
    if (req?.body) {
        if (isFfluidityPacket(req.body)) {
            const seq = fifo.push(req.body);
            sse.send(JSON.stringify(req.body), undefined, seq - 1);
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
