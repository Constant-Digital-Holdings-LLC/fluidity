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
    onMalformed?: (total: number) => void; //dropped SSE payloads (stderr)
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
            //slice(-0) is slice(0): an explicit guard so --history 0 means none
            onHistory: packets => (o.historyLimit === 0 ? [] : packets.slice(-o.historyLimit)).forEach(emit),
            onPacket: emit,
            onState: o.status,
            ...(o.onMalformed !== undefined ? { onMalformed: o.onMalformed } : {})
        }
    );
};
