export const detectCaps = (env, isTTY, mode) => {
    const term = env['TERM'] ?? '';
    const truecolorTerm = /truecolor|24bit/i.test(env['COLORTERM'] ?? '') ||
        Boolean(env['WT_SESSION']) ||
        env['TERM_PROGRAM'] === 'iTerm.app';
    const hyperlinks = truecolorTerm && term !== 'linux' && term !== 'dumb';
    if (mode === 'never') {
        return { tier: 'mono', hyperlinks: false };
    }
    if (mode === '16' || mode === '256' || mode === 'truecolor') {
        return { tier: mode, hyperlinks: mode === 'truecolor' && hyperlinks };
    }
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
//# sourceMappingURL=caps.js.map