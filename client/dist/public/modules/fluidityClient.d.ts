import { FluidityPacket } from '#@shared/types.js';
export declare class FluidityUI {
    protected history: FluidityPacket[];
    protected demarc: number | undefined;
    protected paint(pos: 'before' | 'after', fpArr: FluidityPacket[]): void;
    constructor(history: FluidityPacket[]);
    add(fp: FluidityPacket): void;
}
//# sourceMappingURL=fluidityClient.d.ts.map