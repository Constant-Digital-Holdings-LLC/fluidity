import { isFfluidityPacket } from '#@shared/types.js';
import { PacketFIFO } from './packetFIFO.js';
const fifo = new PacketFIFO(20);
export const GET = (req, res) => {
    return res.status(200).json(fifo.toArray());
};
export const POST = (req, res) => {
    const { body: pakcet } = req || {};
    if (isFfluidityPacket(pakcet)) {
        fifo.push(pakcet);
    }
};
