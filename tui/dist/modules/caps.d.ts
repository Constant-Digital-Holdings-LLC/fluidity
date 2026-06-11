export type ColorTier = 'truecolor' | '256' | '16' | 'mono';
export interface TermCaps {
    tier: ColorTier;
    hyperlinks: boolean;
}
export type ColorMode = 'auto' | 'never' | '16' | '256' | 'truecolor';
export declare const detectCaps: (env: Record<string, string | undefined>, isTTY: boolean, mode: ColorMode) => TermCaps;
//# sourceMappingURL=caps.d.ts.map