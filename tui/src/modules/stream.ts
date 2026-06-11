import { FluidityPacket } from '#@shared/types.js';
import { follow, FollowHandle, ConnState } from './transport.js';
import { matchesFilters, FilterSpec } from './filters.js';
import { renderLine, RenderOpts } from './renderLine.js';

export interface StreamOpts {
    base: URL;
    insecure?: boolean;
    json?: boolean;
    filters: FilterSpec;
    render: RenderOpts;
    historyLimit: number;
    out: (line: string) => void; //packet lines (stdout)
    status: (state: ConnState, detail?: string) => void; //connection state (stderr)
    backoffBaseMs?: number;
}

export const runStream = (o: StreamOpts): FollowHandle => {
    const emit = (p: FluidityPacket): void => {
        if (!matchesFilters(p, o.filters)) return;
        o.out(o.json ? JSON.stringify(p) : renderLine(p, o.render));
    };

    return follow(
        o.base,
        {
            ...(o.backoffBaseMs !== undefined ? { backoffBaseMs: o.backoffBaseMs } : {}),
            ...(o.insecure !== undefined ? { insecure: o.insecure } : {})
        },
        {
            onHistory: packets => packets.slice(-o.historyLimit).forEach(emit),
            onPacket: emit,
            onState: o.status
        }
    );
};
