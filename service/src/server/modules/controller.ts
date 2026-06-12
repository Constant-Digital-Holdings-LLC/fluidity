import { Request, Response, NextFunction } from 'express';
import { isFfluidityPacket } from '#@shared/types.js';
import { PacketFIFO } from './packetFIFO.js';
import { MyConfigData } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger, LoggerUtil } from '#@shared/modules/logger.js';
import { ServerSideEvents } from './sse.js';

export interface FluidityController {
    GET: (req: Request, res: Response) => void;
    POST: (req: Request, res: Response) => void;
    SSE: (req: Request, res: Response, next: NextFunction) => void;
}

export const makeController = (conf?: MyConfigData, log: LoggerUtil = fetchLogger(conf)): FluidityController => {
    const sse = new ServerSideEvents();
    const fifo = new PacketFIFO(conf?.maxServerHistory ?? 300, log);

    return {
        SSE: (req, res, next) => {
            sse.init(req, res, next);
        },

        GET: (req, res) => {
            res.status(200).json(fifo.toArray());
        },

        POST: (req, res) => {
            //pass the object itself: the logger only serializes after its
            //level gate, so info+ configs don't pay a stringify per POST
            log.debug({ note: 'FIFO Controller POST headers', headers: req.headers });

            if (req?.body && isFfluidityPacket(req.body)) {
                const seq = fifo.push(req.body);
                //the SSE id mirrors the packet's own seq (counter starts at 1)
                sse.send(JSON.stringify(req.body), undefined, seq);
                res.end();
            } else {
                log.warn(`No Fluidity Packet in Req Body: ${JSON.stringify(req.body)}`);
                res.status(400).json({ error: 'request body is not a fluidity packet' });
            }
        }
    };
};
