import https from 'node:https';
import http from 'node:http';
import { isFfluidityPacket } from '#@shared/types.js';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const shouldVerifyTLS = (url, insecure) => !insecure && !LOOPBACK_HOSTS.has(url.hostname);
const request = (url, insecure, headers) => {
    if (url.protocol === 'http:') {
        return http.request(url, { headers });
    }
    return https.request(url, { headers, rejectUnauthorized: shouldVerifyTLS(url, insecure) });
};
const getResponse = (url, insecure, headers = {}) => new Promise((resolve, reject) => {
    const req = request(url, insecure, headers);
    req.on('response', res => {
        if (res.statusCode === 200) {
            resolve(res);
        }
        else {
            res.resume();
            reject(new Error(`${url.pathname}: HTTP ${res.statusCode ?? 0}`));
        }
    });
    req.on('error', reject);
    req.end();
});
export const fetchHistory = async (base, insecure) => {
    const res = await getResponse(new URL('/FIFO', base), insecure);
    let body = '';
    for await (const chunk of res) {
        body += chunk;
    }
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) {
        throw new Error('/FIFO did not return an array');
    }
    return parsed.filter((p) => isFfluidityPacket(p));
};
const keyOf = (p) => `${p.seq ?? -1}:${p.ts}`;
export const follow = (base, opts, events) => {
    const backoffBase = opts.backoffBaseMs ?? 1000;
    const backoffMax = opts.backoffMaxMs ?? 30_000;
    const seen = new Set();
    const SEEN_CAP = 10_000;
    let stopped = false;
    let activeReq;
    let attempt = 0;
    const remember = (p) => {
        const k = keyOf(p);
        if (seen.has(k))
            return false;
        seen.add(k);
        if (seen.size > SEEN_CAP) {
            for (const old of seen) {
                seen.delete(old);
                if (seen.size <= SEEN_CAP / 2)
                    break;
            }
        }
        return true;
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const streamSSE = () => new Promise((resolve, reject) => {
        const req = request(new URL('/SSE', base), opts.insecure, { accept: 'text/event-stream' });
        activeReq = req;
        req.on('response', res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`/SSE: HTTP ${res.statusCode ?? 0}`));
                return;
            }
            attempt = 0;
            events.onState?.('live');
            let buf = '';
            res.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                let sep;
                while ((sep = buf.indexOf('\n\n')) !== -1) {
                    const block = buf.slice(0, sep);
                    buf = buf.slice(sep + 2);
                    const data = block
                        .split('\n')
                        .filter(l => l.startsWith('data:'))
                        .map(l => l.slice(5).trim())
                        .join('\n');
                    if (!data)
                        continue;
                    try {
                        const p = JSON.parse(data);
                        if (isFfluidityPacket(p) && remember(p)) {
                            events.onPacket(p);
                        }
                    }
                    catch {
                    }
                }
            });
            res.on('end', () => resolve());
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
    });
    const loop = async () => {
        let firstRound = true;
        while (!stopped) {
            try {
                events.onState?.(firstRound ? 'connecting' : 'reconnecting');
                const history = (await fetchHistory(base, opts.insecure)).filter(remember);
                if (history.length) {
                    events.onHistory(history);
                }
                firstRound = false;
                await streamSSE();
                throw new Error('SSE stream ended');
            }
            catch (err) {
                if (stopped)
                    break;
                const delay = Math.min(backoffMax, backoffBase * 2 ** attempt) * (0.75 + Math.random() * 0.5);
                attempt = Math.min(attempt + 1, 10);
                events.onState?.('reconnecting', err instanceof Error ? err.message : String(err));
                await sleep(delay);
            }
        }
        events.onState?.('stopped');
    };
    void loop();
    return {
        stop() {
            stopped = true;
            activeReq?.destroy();
        }
    };
};
//# sourceMappingURL=transport.js.map