import { ColorTier } from './caps.js';
export interface StyleDef {
    readonly hex: string;
    readonly ansi16: number;
    readonly bold?: boolean;
    readonly dim?: boolean;
    readonly underline?: boolean;
}
export type ChromeRole = 'timestamp' | 'bracket' | 'site' | 'description' | 'separator';
export declare const styleDef: (suggestStyle: number) => StyleDef;
export declare const chromeDef: (role: ChromeRole) => StyleDef;
export declare const hexTo256: (hex: string) => number;
export declare const paint: (text: string, def: StyleDef, tier: ColorTier) => string;
//# sourceMappingURL=theme.d.ts.map