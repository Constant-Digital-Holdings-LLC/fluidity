import { FluidityPacket, FormattedData } from '#@shared/types.js';
export declare class FluidityUI {
    protected history: FluidityPacket[];
    private demarc;
    private fm;
    private highestScrollPos;
    private lastVh;
    private liveArrivals;
    protected typeFn: (root: HTMLElement, opts?: import("./typewriter.js").TypeOpts) => void;
    protected now: () => number;
    constructor(history: FluidityPacket[]);
    refreshLiveness(now?: number): void;
    flushFrame(): void;
    private scrollReset;
    private autoScroll;
    private autoScrollRequest;
    protected renderFormattedData(fArr: FormattedData[]): DocumentFragment;
    private packetRender;
    private evictOldest;
    private packetSet;
    private floodBypass;
    resync(history: FluidityPacket[]): void;
    packetAdd(fp: FluidityPacket): void;
}
//# sourceMappingURL=ui.d.ts.map