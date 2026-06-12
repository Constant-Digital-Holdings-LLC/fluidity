//Headless SSE-follow for the watcher (W1): subscribe to a Fluidity server,
//reconcile via /FIFO on every (re)connect, dedup by seq+ts, reconnect with
//backoff, and surface connection state so the matcher can gate absence.
//
//This mirrors the TUI's tui/src/modules/transport.ts (the reference
//implementation), reimplemented here because the build order (client ->
//sims/service/tui) forbids the service importing from the tui package. The
//loadtest harness has its own measurement-specific SSE reader; this one is
//packet-oriented.

import https from 'node:https';
import http from 'node:http';
import { IncomingMessage, ClientRequest } from 'node:http';
import { FluidityPacket, isFfluidityPacket } from '#@shared/types.js';

export interface FollowEvents {
    //the /FIFO snapshot on each (re)connect - seed last-seen, don't fire
    onReconcile: (packets: FluidityPacket[]) => void;
    onPacket: (p: FluidityPacket) => void;
    onConnected: () => void;
    onDisconnected: (detail?: string) => void;
}

export interface FollowOpts {
    insecure?: boolean;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const shouldVerifyTLS = (url: URL, insecure?: boolean): boolean => !insecure && !LOOPBACK_HOSTS.has(url.hostname);

const request = (url: URL, insecure: boolean | undefined, headers: Record<string, string>): ClientRequest =>
    url.protocol === 'http:'
        ? http.request(url, { headers })
        : https.request(url, { headers, rejectUnauthorized: shouldVerifyTLS(url, insecure) });

const getResponse = (
    url: URL,
    insecure: boolean | undefined,
    onReq?: (r: ClientRequest) => void
): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
        const req = request(url, insecure, {});
        onReq?.(req);
        req.on('response', res => {
            if (res.statusCode === 200) resolve(res);
            else {
                res.resume();
                reject(new Error(`${url.pathname}: HTTP ${res.statusCode ?? 0}`));
            }
        });
        req.on('error', reject);
        req.end();
    });

const fetchFifo = async (
    base: URL,
    insecure: boolean | undefined,
    onReq?: (r: ClientRequest) => void
): Promise<FluidityPacket[]> => {
    const res = await getResponse(new URL('/FIFO', base), insecure, onReq);
    res.setEncoding('utf8'); //chunk-safe UTF-8
    let body = '';
    for await (const chunk of res) body += String(chunk);
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) throw new Error('/FIFO did not return an array');
    return parsed.filter((p): p is FluidityPacket => isFfluidityPacket(p));
};

const keyOf = (p: FluidityPacket): string => `${p.seq ?? -1}:${p.ts}`;

export interface FollowHandle {
    stop(): void;
}

export const follow = (base: URL, opts: FollowOpts, events: FollowEvents): FollowHandle => {
    const backoffBase = opts.backoffBaseMs ?? 1000;
    const backoffMax = opts.backoffMaxMs ?? 30_000;
    const seen = new Set<string>();
    const SEEN_CAP = 10_000;

    let stopped = false;
    let activeReq: ClientRequest | undefined;
    let attempt = 0;
    let backoffTimer: NodeJS.Timeout | undefined;
    let backoffResolve: (() => void) | undefined;

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
                events.onConnected();

                res.setEncoding('utf8');
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
                            if (isFfluidityPacket(p) && remember(p)) events.onPacket(p);
                        } catch {
                            //malformed SSE payloads are dropped, never fatal
                        }
                    }
                    if (buf.length > MAX_BUF) buf = '';
                });
                res.on('end', () => resolve());
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        });

    const loop = async (): Promise<void> => {
        while (!stopped) {
            try {
                const fifo = await fetchFifo(base, opts.insecure, r => {
                    activeReq = r;
                });
                fifo.forEach(remember); //don't re-emit history as live packets
                events.onReconcile(fifo);
                await streamSSE();
                throw new Error('SSE stream ended');
            } catch (err) {
                if (stopped) break;
                events.onDisconnected(err instanceof Error ? err.message : String(err));
                const delay = Math.min(backoffMax, backoffBase * 2 ** attempt) * (0.75 + Math.random() * 0.5);
                attempt = Math.min(attempt + 1, 10);
                await sleep(delay);
            }
        }
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
