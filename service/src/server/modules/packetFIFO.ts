import { FluidityPacket } from '#@shared/types.js';
import { fetchLogger, LoggerUtil } from '#@shared/modules/logger.js';
import { counter } from '#@shared/modules/utils.js';

export class PacketFIFO {
    protected buffer: FluidityPacket[];
    protected count: IterableIterator<number>;

    constructor(protected maxSize: number, protected log: LoggerUtil = fetchLogger()) {
        this.buffer = [];
        this.count = counter();
    }

    push(fPacket: FluidityPacket): number {
        if (this.buffer.length >= this.maxSize) this.buffer.shift();
        fPacket.seq = this.count.next().value as number;
        this.log.debug(`PacketFIFO received ${JSON.stringify(fPacket)}`);
        this.buffer.push(fPacket);
        return fPacket.seq;
    }

    toArray(): FluidityPacket[] {
        return [...this.buffer];
    }
}
