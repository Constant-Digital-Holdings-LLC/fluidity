import { fetchLogger } from '#@shared/modules/logger.js';
import { counter } from '#@shared/modules/utils.js';
export class PacketFIFO {
    maxSize;
    log;
    buffer;
    count;
    constructor(maxSize, log = fetchLogger()) {
        this.maxSize = maxSize;
        this.log = log;
        if (!Number.isInteger(maxSize) || maxSize < 0) {
            throw new Error(`PacketFIFO maxSize must be a non-negative integer, got: ${JSON.stringify(maxSize)}`);
        }
        this.buffer = [];
        this.count = counter();
    }
    push(fPacket) {
        fPacket.seq = this.count.next().value;
        this.log.debug(fPacket);
        if (this.maxSize > 0) {
            while (this.buffer.length >= this.maxSize)
                this.buffer.shift();
            this.buffer.push(fPacket);
        }
        return fPacket.seq;
    }
    toArray() {
        return [...this.buffer];
    }
}
