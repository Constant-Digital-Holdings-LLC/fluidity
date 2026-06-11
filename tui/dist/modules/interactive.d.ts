import { FollowHandle } from './transport.js';
import { FilterSpec } from './filters.js';
import { TermCaps } from './caps.js';
export interface InteractiveOpts {
    base: URL;
    insecure?: boolean;
    filters: FilterSpec;
    caps: TermCaps;
    showUrls?: boolean;
    historyLimit: number;
}
export declare const runInteractive: (o: InteractiveOpts, onQuit: () => void) => FollowHandle;
//# sourceMappingURL=interactive.d.ts.map