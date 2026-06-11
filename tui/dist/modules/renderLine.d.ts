import { FluidityPacket } from '#@shared/types.js';
import { TermCaps } from './caps.js';
export interface RenderOpts {
    caps: TermCaps;
    showUrls?: boolean;
    timeZone?: string;
    locale?: string;
}
export interface RenderedParts {
    time: string;
    site: string;
    desc: string;
    fields: string;
}
export declare const renderParts: (p: FluidityPacket, o: RenderOpts) => RenderedParts;
export declare const composeChrome: (parts: RenderedParts, o: RenderOpts, pad?: {
    time: number;
    site: number;
    desc: number;
}) => string;
export declare const renderLine: (p: FluidityPacket, o: RenderOpts) => string;
//# sourceMappingURL=renderLine.d.ts.map