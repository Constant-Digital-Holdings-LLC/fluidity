import { FluidityPacket } from '#@shared/types.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { counter } from '#@shared/modules/utils.js';

const log = fetchLogger(await confFromFS());
const count = counter();

export class PacketFIFO {
    protected buffer: FluidityPacket[];

    constructor(protected maxSize: number) {
        this.buffer = [];
    }

    push(fPacket: FluidityPacket): number {
        if (this.buffer.length >= this.maxSize) this.buffer.shift();
        fPacket.seq = count.next().value;
        log.debug(`PacketFIFO received ${JSON.stringify(fPacket)}`);
        return this.buffer.push(fPacket);
    }

    toArray(): FluidityPacket[] {
        return this.buffer;
    }
}
