import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
const log = fetchLogger(await confFromFS());
export class PacketFIFO {
    maxSize;
    buffer;
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = [];
    }
    push(fPacket) {
        if (this.buffer.length >= this.maxSize)
            this.buffer.pop();
        log.debug(`PacketFIFO received ${JSON.stringify(fPacket)}`);
        return this.buffer.push(fPacket);
    }
    toArray() {
        return this.buffer;
    }
}
