import { FollowHandle, ConnState } from './transport.js';
import { FilterSpec } from './filters.js';
import { RenderOpts } from './renderLine.js';
export interface StreamOpts {
    base: URL;
    insecure?: boolean;
    json?: boolean;
    filters: FilterSpec;
    render: RenderOpts;
    historyLimit: number;
    out: (line: string) => void;
    status: (state: ConnState, detail?: string) => void;
    onMalformed?: (total: number) => void;
    backoffBaseMs?: number;
}
export declare const runStream: (o: StreamOpts) => FollowHandle;
//# sourceMappingURL=stream.d.ts.map