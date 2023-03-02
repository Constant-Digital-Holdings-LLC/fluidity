import { FluidityPacket, FormattedData } from '#@shared/types.js';
export declare class FluidityUI {
    protected history: FluidityPacket[];
    private demarc;
    private fm;
    protected renderFormattedData(fArr: FormattedData[]): DocumentFragment;
    private packetRender;
    private packetSet;
    constructor(history: FluidityPacket[]);
    packetAdd(fp: FluidityPacket): void;
}
//# sourceMappingURL=ui.d.ts.map