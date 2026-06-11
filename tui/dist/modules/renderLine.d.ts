import { FluidityPacket } from '#@shared/types.js';
import { TermCaps } from './caps.js';
export interface RenderOpts {
    caps: TermCaps;
    showUrls?: boolean;
    timeZone?: string;
    locale?: string;
}
export declare const renderLine: (p: FluidityPacket, o: RenderOpts) => string;
//# sourceMappingURL=renderLine.d.ts.map