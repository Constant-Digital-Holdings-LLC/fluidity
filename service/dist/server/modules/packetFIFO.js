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
        this.buffer = [];
        this.count = counter();
    }
    push(fPacket) {
        if (this.buffer.length >= this.maxSize)
            this.buffer.shift();
        fPacket.seq = this.count.next().value;
        this.log.debug(`PacketFIFO received ${JSON.stringify(fPacket)}`);
        this.buffer.push(fPacket);
        return fPacket.seq;
    }
    toArray() {
        return [...this.buffer];
    }
}
