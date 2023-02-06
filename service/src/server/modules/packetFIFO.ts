import { FluidityPacket } from '#@shared/types.js';

export class PacketFIFO {
    protected buffer: FluidityPacket[];

    constructor(protected maxSize: number) {
        this.buffer = [];
    }

    push(fPacket: FluidityPacket): number {
        if (this.buffer.length > this.maxSize) this.buffer.pop();
        return this.buffer.push(fPacket);
    }

    toArray(): FluidityPacket[] {
        return this.buffer;
    }
}
