//terminal capability detection - the four-tier ladder from SPEC.md §4.1

export type ColorTier = 'truecolor' | '256' | '16' | 'mono';

export interface TermCaps {
    tier: ColorTier;
    hyperlinks: boolean;
}

export type ColorMode = 'auto' | 'never' | '16' | '256' | 'truecolor';

export const detectCaps = (env: Record<string, string | undefined>, isTTY: boolean, mode: ColorMode): TermCaps => {
    const term = env['TERM'] ?? '';

    const truecolorTerm =
        /truecolor|24bit/i.test(env['COLORTERM'] ?? '') ||
        Boolean(env['WT_SESSION']) ||
        env['TERM_PROGRAM'] === 'iTerm.app';

    //OSC 8 links: modern emulators only - never the linux console or dumb terminals
    const hyperlinks = truecolorTerm && term !== 'linux' && term !== 'dumb';

    if (mode === 'never') {
        return { tier: 'mono', hyperlinks: false };
    }
    if (mode === '16' || mode === '256' || mode === 'truecolor') {
        return { tier: mode, hyperlinks: mode === 'truecolor' && hyperlinks };
    }

    //auto
    if (env['NO_COLOR'] !== undefined) {
        return { tier: 'mono', hyperlinks: false };
    }
    if (!isTTY && env['FORCE_COLOR'] === undefined) {
        return { tier: 'mono', hyperlinks: false };
    }
    if (term === 'dumb') {
        return { tier: 'mono', hyperlinks: false };
    }
    if (truecolorTerm) {
        return { tier: 'truecolor', hyperlinks };
    }
    if (term.includes('256color')) {
        return { tier: '256', hyperlinks: false };
    }
    return { tier: '16', hyperlinks: false };
};
