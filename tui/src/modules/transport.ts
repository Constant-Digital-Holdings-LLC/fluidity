import https from 'node:https';
import http from 'node:http';
import { IncomingMessage, ClientRequest } from 'node:http';
import { FluidityPacket, isFfluidityPacket } from '#@shared/types.js';

export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'stopped';

export interface FollowOpts {
    insecure?: boolean;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
}

export interface FollowEvents {
    onHistory: (packets: FluidityPacket[]) => void;
    onPacket: (p: FluidityPacket) => void;
    onState?: (state: ConnState, detail?: string) => void;
    //dropped SSE payloads (unparseable / failed the packet guard), running total
    onMalformed?: (total: number) => void;
}

export interface FollowHandle {
    stop(): void;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

//TLS verification is relaxed for loopback only (dev certs are self-signed;
//loopback MITM is not the threat model) - SPEC.md §6
export const shouldVerifyTLS = (url: URL, insecure?: boolean): boolean =>
    !insecure && !LOOPBACK_HOSTS.has(url.hostname);

const request = (url: URL, insecure: boolean | undefined, headers: Record<string, string>): ClientRequest => {
    if (url.protocol === 'http:') {
        return http.request(url, { headers });
    }
    return https.request(url, { headers, rejectUnauthorized: shouldVerifyTLS(url, insecure) });
};

const getResponse = (
    url: URL,
    insecure: boolean | undefined,
    headers: Record<string, string> = {},
    onRequest?: (req: ClientRequest) => void
): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
        const req = request(url, insecure, headers);
        onRequest?.(req);
        req.on('response', res => {
            if (res.statusCode === 200) {
                resolve(res);
            } else {
                res.resume();
                reject(new Error(`${url.pathname}: HTTP ${res.statusCode ?? 0}`));
            }
        });
        req.on('error', reject);
        req.end();
    });

export const fetchHistory = async (
    base: URL,
    insecure?: boolean,
    onRequest?: (req: ClientRequest) => void
): Promise<FluidityPacket[]> => {
    const res = await getResponse(new URL('/FIFO', base), insecure, {}, onRequest);

    //setEncoding makes chunks real strings and holds a multibyte UTF-8
    //sequence split across chunks until it completes (no U+FFFD seams)
    res.setEncoding('utf8');
    let body = '';
    for await (const chunk of res) {
        body += String(chunk);
    }

    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) {
        throw new Error('/FIFO did not return an array');
    }
    return parsed.filter((p): p is FluidityPacket => isFfluidityPacket(p));
};

//packet identity across reconnects: seq alone resets when the server restarts,
//so the dedupe key is seq+ts (SPEC.md §5)
const keyOf = (p: FluidityPacket): string => `${p.seq ?? -1}:${p.ts}`;

export const follow = (base: URL, opts: FollowOpts, events: FollowEvents): FollowHandle => {
    const backoffBase = opts.backoffBaseMs ?? 1000;
    const backoffMax = opts.backoffMaxMs ?? 30_000;
    const seen = new Set<string>();
    const SEEN_CAP = 10_000;

    let stopped = false;
    let activeReq: ClientRequest | undefined;
    let attempt = 0;
    let malformed = 0;
    let backoffTimer: NodeJS.Timeout | undefined;
    let backoffResolve: (() => void) | undefined;

    const noteMalformed = (): void => {
        malformed++;
        events.onMalformed?.(malformed);
    };

    const remember = (p: FluidityPacket): boolean => {
        const k = keyOf(p);
        if (seen.has(k)) return false;
        seen.add(k);
        if (seen.size > SEEN_CAP) {
            for (const old of seen) {
                seen.delete(old);
                if (seen.size <= SEEN_CAP / 2) break;
            }
        }
        return true;
    };

    //the backoff sleep is cancelable: stop() clears the timer and resolves
    //immediately, so a handle never lingers for up to 30s after stop
    const sleep = (ms: number): Promise<void> =>
        new Promise(r => {
            backoffResolve = r;
            backoffTimer = setTimeout(() => {
                backoffTimer = undefined;
                backoffResolve = undefined;
                r();
            }, ms);
        });

    const streamSSE = (): Promise<void> =>
        new Promise((resolve, reject) => {
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

                //string chunks with multibyte sequences held across boundaries
                res.setEncoding('utf8');
                //a stream that never sends a frame terminator must not grow
                //the reassembly buffer without bound
                const MAX_BUF = 1024 * 1024;

                let buf = '';
                res.on('data', (chunk: string) => {
                    buf += chunk;

                    let sep;
                    while ((sep = buf.indexOf('\n\n')) !== -1) {
                        const block = buf.slice(0, sep);
                        buf = buf.slice(sep + 2);

                        const data = block
                            .split('\n')
                            .filter(l => l.startsWith('data:'))
                            .map(l => l.slice(5).trim())
                            .join('\n');
                        if (!data) continue;

                        try {
                            const p: unknown = JSON.parse(data);
                            if (isFfluidityPacket(p)) {
                                if (remember(p)) events.onPacket(p);
                            } else {
                                noteMalformed();
                            }
                        } catch {
                            //malformed payloads are dropped, never fatal -
                            //but counted and surfaced (SPEC.md §8)
                            noteMalformed();
                        }
                    }

                    //all complete frames consumed; what remains has no
                    //terminator - reset rather than grow without bound
                    if (buf.length > MAX_BUF) {
                        buf = '';
                        noteMalformed();
                    }
                });

                res.on('end', () => resolve());
                res.on('error', reject);
            });

            req.on('error', reject);
            req.end();
        });

    const loop = async (): Promise<void> => {
        let firstRound = true;

        while (!stopped) {
            try {
                events.onState?.(firstRound ? 'connecting' : 'reconnecting');

                //the history request is tracked like the SSE request so
                //stop() can abort it in flight
                const history = (
                    await fetchHistory(base, opts.insecure, req => {
                        activeReq = req;
                    })
                ).filter(remember);
                if (history.length) {
                    events.onHistory(history);
                }
                firstRound = false;

                await streamSSE(); //resolves/rejects when the stream drops
                throw new Error('SSE stream ended');
            } catch (err) {
                if (stopped) break;
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
        stop(): void {
            stopped = true;
            activeReq?.destroy();
            if (backoffTimer) clearTimeout(backoffTimer);
            backoffTimer = undefined;
            backoffResolve?.();
            backoffResolve = undefined;
        }
    };
};
