import { RingBuffer } from 'ring-buffer-ts';
export class PacketBuffer {
    ringBuffer;
    constructor() {
        this.ringBuffer = new RingBuffer(5);
    }
    push(fPacket) {
        return this.ringBuffer.add(fPacket);
    }
    toArray() {
        return this.ringBuffer.toArray();
    }
}
