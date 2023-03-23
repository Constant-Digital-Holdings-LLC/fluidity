import { FluidityPacket, FormattedData } from '#@shared/types.js';
export declare class FluidityUI {
    protected history: FluidityPacket[];
    private demarc;
    private fm;
    private highestScrollPos;
    private lastVh;
    constructor(history: FluidityPacket[]);
    private autoScroll;
    private autoScrollRequest;
    protected renderFormattedData(fArr: FormattedData[]): DocumentFragment;
    private packetRender;
    private packetSet;
    packetAdd(fp: FluidityPacket): void;
}
//# sourceMappingURL=ui.d.ts.map