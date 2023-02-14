import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { counter } from '#@shared/modules/utils.js';
const log = fetchLogger(await confFromFS());
const count = counter();
export class PacketFIFO {
    maxSize;
    buffer;
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = [];
    }
    push(fPacket) {
        if (this.buffer.length >= this.maxSize)
            this.buffer.shift();
        log.debug(`PacketFIFO received ${JSON.stringify(fPacket)}`);
        fPacket.seq = count.next().value;
        return this.buffer.push(fPacket);
    }
    toArray() {
        return this.buffer;
    }
}
