import { FluidityPacket } from '#@shared/types.js';
import { fetchLogger, LoggerUtil } from '#@shared/modules/logger.js';
import { counter } from '#@shared/modules/utils.js';

export class PacketFIFO {
    protected buffer: FluidityPacket[];
    protected count: IterableIterator<number>;

    constructor(
        protected maxSize: number,
        protected log: LoggerUtil = fetchLogger()
    ) {
        //conf values arrive unvalidated from JSON: a non-numeric
        //maxServerHistory would make the eviction comparison NaN-false
        //forever (unbounded growth) - misconfiguration throws at startup
        if (!Number.isInteger(maxSize) || maxSize < 0) {
            throw new Error(`PacketFIFO maxSize must be a non-negative integer, got: ${JSON.stringify(maxSize)}`);
        }
        this.buffer = [];
        this.count = counter();
    }

    push(fPacket: FluidityPacket): number {
        fPacket.seq = this.count.next().value as number;
        //object, not template: the logger serializes after its level gate
        this.log.debug(fPacket);
        //maxSize 0 means no history retention - seq still advances
        if (this.maxSize > 0) {
            while (this.buffer.length >= this.maxSize) this.buffer.shift();
            this.buffer.push(fPacket);
        }
        return fPacket.seq;
    }

    toArray(): FluidityPacket[] {
        return [...this.buffer];
    }
}
