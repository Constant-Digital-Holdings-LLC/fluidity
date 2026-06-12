const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
export const normalizeServerUrl = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed)
        throw new Error('server URL is empty');
    const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
    let url;
    try {
        url = new URL(withScheme);
    }
    catch {
        throw new Error(`invalid server URL: ${raw}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`unsupported server URL scheme "${url.protocol.replace(':', '')}" (use http or https): ${raw}`);
    }
    if (!url.hostname)
        throw new Error(`server URL has no host: ${raw}`);
    return url;
};
//# sourceMappingURL=serverUrl.js.map