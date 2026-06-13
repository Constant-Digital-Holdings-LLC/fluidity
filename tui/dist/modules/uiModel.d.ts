import { FluidityPacket } from '#@shared/types.js';
import { FilterSpec } from './filters.js';
import { ConnState } from './transport.js';
import { Key } from './keys.js';
import { RenderedParts } from './renderLine.js';
export interface Entry {
    site: string;
    plugin: string;
    parts: RenderedParts;
}
export interface ColumnWidths {
    time: number;
    site: number;
    desc: number;
}
export type FilterGroup = 'sites' | 'collectors';
export interface UIState {
    cols: number;
    rows: number;
    serverHost: string;
    conn: ConnState;
    entries: Entry[];
    historyLimit: number;
    seenSites: Map<string, number>;
    seenCollectors: Map<string, number>;
    siteLastSeen: Map<string, number>;
    rateSeries: number[];
    pulseWindowIdx: number;
    malformed: number;
    filters: FilterSpec;
    group: FilterGroup;
    columns: ColumnWidths;
    scrollOffset: number;
    paused: boolean;
    pausedAtCount: number;
    showHelp: boolean;
    showHeartbeats: boolean;
    quit: boolean;
}
export declare const initialState: (cols: number, rows: number, serverHost: string, historyLimit: number) => UIState;
export declare const addPacket: (st: UIState, p: FluidityPacket, parts: RenderedParts) => void;
export declare const visibleEntries: (st: UIState) => Entry[];
export declare const pendingWhilePaused: (st: UIState) => number;
export declare const viewportRows: (st: UIState) => number;
export declare const handleKey: (st: UIState, key: Key) => void;
//# sourceMappingURL=uiModel.d.ts.map