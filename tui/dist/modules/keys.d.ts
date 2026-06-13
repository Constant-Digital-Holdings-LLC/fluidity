export type KeyName = 'quit' | 'up' | 'down' | 'pageUp' | 'pageDown' | 'top' | 'bottom' | 'pause' | 'tab' | 'clear' | 'help' | 'window' | 'heartbeats' | 'digit' | 'other';
export interface Key {
    name: KeyName;
    digit?: number;
}
export declare const parseKeys: (chunk: Buffer) => Key[];
//# sourceMappingURL=keys.d.ts.map