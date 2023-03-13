import { FluidityPacket, FormattedData } from '#@shared/types.js';
export declare class FluidityUI {
    protected history: FluidityPacket[];
    private demarc;
    private fm;
    private activeScrolling;
    private scrollStateTimer;
    constructor(history: FluidityPacket[]);
    private autoScroll;
    private scrollHandler;
    private autoScrollRequest;
    protected renderFormattedData(fArr: FormattedData[]): DocumentFragment;
    private packetRender;
    private packetSet;
    packetAdd(fp: FluidityPacket): void;
}
//# sourceMappingURL=ui.d.ts.map