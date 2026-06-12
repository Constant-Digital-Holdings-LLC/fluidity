//Forgiving parse of a user-supplied server URL. People type "localhost:3000"
//or "f-y.io" far more often than a full "https://host:3000", so accept those:
//default the scheme to https, tolerate surrounding whitespace and a stray
//leading "//", and reject anything that isn't http(s) with a clear message.
//Pure + unit-tested; app.ts is the thin orchestrator that surfaces the error.
//
//Note "localhost:3000" must NOT go straight to new URL() - it parses the
//"localhost:" as a scheme. Detecting a real "scheme://" prefix first avoids
//that classic footgun.

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export const normalizeServerUrl = (raw: string): URL => {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('server URL is empty');

    //no explicit scheme -> assume https (and drop a stray leading "//")
    const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;

    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        throw new Error(`invalid server URL: ${raw}`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`unsupported server URL scheme "${url.protocol.replace(':', '')}" (use http or https): ${raw}`);
    }
    if (!url.hostname) throw new Error(`server URL has no host: ${raw}`);
    return url;
};
