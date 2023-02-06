export class PacketFIFO {
    maxSize;
    buffer;
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = [];
    }
    push(fPacket) {
        if (this.buffer.length > this.maxSize)
            this.buffer.pop();
        return this.buffer.push(fPacket);
    }
    toArray() {
        return this.buffer;
    }
}
