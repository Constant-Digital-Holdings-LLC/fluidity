//End-to-end load harness: drives real components in one process - the stress
//emitter fires real datagrams at a real udpStruct collector, which posts over
//real HTTPS to a real makeApp server, with optional SSE subscribers measuring
//fanout latency. Returns a structured report (throughput, drops, backpressure,
//event-loop lag, memory, SSE latency). Used by `npm run loadtest` (cli.ts) and
//by a small functional test in the normal suite, so the tool we ship is the
//tool that's tested.
//
//Single process by design: simple, deterministic teardown, and the combined
//event-loop lag is itself a useful "is the whole stack keeping up" signal. For
//per-component CPU attribution, run the CLI under `node --cpu-prof`.

import https from 'node:https';
import { ClientRequest } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { makeApp } from '../server/modules/expressApp.js';
import UdpStructCollector from '../agent/modules/collectors/udpStruct.js';
import { runUdpStress, StressCategory } from '#@sims/udpStressEmitter.js';

//dev certs live next to the built server (cwd-independent: resolved from here)
const sslPath = (f: string): string => fileURLToPath(new URL(`../server/ssl/${f}`, import.meta.url));

export interface LoadtestOptions {
    rate?: number; //datagrams/sec offered (default 5000)
    durationSec?: number; //default 5
    devices?: number; //distinct sites (default 50)
    mix?: Partial<Record<StressCategory, number>>; //default { valid: 100 }
    secret?: string; //32 hex: sign valid traffic + run the collector in MAC mode
    requireMac?: boolean; //collector MAC policy (default true when secret given)
    throttle?: number; //collector maxHttpsReqPerCollectorPerSec (default 100000)
    sseClients?: number; //SSE subscribers measuring fanout latency (default 0)
    seed?: number;
}

export interface LoadtestReport {
    offered: number;
    offeredPps: number;
    durationSec: number;
    agent: {
        //the collector surfaces only failure accounting (dropCounts + shed);
        //the success count is server.posts, measured where it lands
        drops: Record<string, number>;
        shed: number;
        loopMeanMs: number;
        loopMaxMs: number;
    };
    server: { posts: number }; //POSTs completed with a 2xx response
    sse: { clients: number; frames: number; latP50Ms: number; latP95Ms: number } | null;
    memoryMB: { rss: number; heap: number };
}

const pct = (arr: number[], p: number): number => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    //nearest-rank: 1-based rank ceil(p/100 * N), clamped into the array
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0;
};

export const runLoadtest = async (opts: LoadtestOptions = {}): Promise<LoadtestReport> => {
    const rate = opts.rate ?? 5000;
    const durationSec = opts.durationSec ?? 5;
    const throttle = opts.throttle ?? 100000;
    const sseClients = opts.sseClients ?? 0;
    const secret = opts.secret;
    const requireMac = secret ? (opts.requireMac ?? true) : false;

    const tls = {
        key: readFileSync(sslPath('dev-server_key.pem')),
        cert: readFileSync(sslPath('dev-server_cert.pem'))
    };
    const conf = {
        appName: 'Fluidity',
        appVersion: 'loadtest',
        logLevel: 'never' as const,
        permittedKeys: ['loadtestkey1'],
        maxServerHistory: 300
    };

    let posts = 0;
    const server = https.createServer(tls, makeApp(conf));
    //count a post only once its response completes with success: at header
    //arrival nothing has been validated yet, and a 400 must not count
    server.on('request', (req, res) => {
        res.on('finish', () => {
            if (req.method === 'POST' && res.statusCode < 300) posts++;
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const serverPort = (server.address() as AddressInfo).port;

    //SSE subscribers: one measures latency (agent ts -> arrival), the rest are
    //fanout load on the server's broadcast path
    const sseAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
    const lat: number[] = [];
    let frames = 0;
    const sseReqs: ClientRequest[] = [];
    for (let i = 0; i < sseClients; i++) {
        const measure = i === 0;
        const req = https.request(
            { host: '127.0.0.1', port: serverPort, path: '/SSE', method: 'GET', agent: sseAgent },
            res => {
                let buf = '';
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    buf += chunk;
                    let nl;
                    while ((nl = buf.indexOf('\n\n')) !== -1) {
                        const line = buf
                            .slice(0, nl)
                            .split('\n')
                            .find(l => l.startsWith('data: '));
                        buf = buf.slice(nl + 2);
                        if (!line) continue;
                        frames++;
                        if (!measure) continue;
                        try {
                            const ts = Date.parse((JSON.parse(line.slice(6)) as { ts: string }).ts);
                            if (!Number.isNaN(ts)) lat.push(Date.now() - ts);
                        } catch {
                            //a partial/garbled frame under load is fine to skip
                        }
                    }
                });
            }
        );
        req.on('error', () => undefined);
        req.end();
        sseReqs.push(req);
    }
    if (sseClients) await sleep(200); //let subscriptions establish

    const collector = new UdpStructCollector({
        plugin: 'udpStruct',
        description: 'loadtest',
        site: 'loadtest-agent',
        targets: [{ location: `https://localhost:${serverPort}/FIFO`, key: 'loadtestkey1' }],
        port: 0,
        bind: '127.0.0.1',
        maxHttpsReqPerCollectorPerSec: throttle,
        ...(secret ? { extendedOptions: { secret, requireMac } } : {})
    });
    collector.start();
    const udpPort = await collector.ready();

    const eld = monitorEventLoopDelay({ resolution: 10 });
    eld.enable();

    try {
        const report = await runUdpStress({
            port: udpPort,
            rate,
            durationSec,
            devices: opts.devices ?? 50,
            mix: opts.mix ?? { valid: 100 },
            ...(secret ? { secret } : {}),
            seed: opts.seed ?? 0xc0ffee
        }).done;

        await sleep(1500); //drain the upstream backlog
        eld.disable();

        const drops: Record<string, number> = {};
        for (const [k, v] of collector.dropCounts) drops[k] = v;
        //udpStruct attributes its backpressure in dropCounts (pre-empting the base
        //path, so base shedTotal stays 0); fold both into one shed figure and keep
        //`drops` to validation reasons only, so the report can't read contradictory
        const shed = (drops['backpressure'] ?? 0) + collector.backpressureShed;
        delete drops['backpressure'];
        const mem = process.memoryUsage();

        return {
            offered: report.totalSent,
            offeredPps: report.achievedPps,
            durationSec,
            agent: {
                drops,
                shed,
                loopMeanMs: +(eld.mean / 1e6).toFixed(2),
                loopMaxMs: +(eld.max / 1e6).toFixed(2)
            },
            server: { posts },
            sse: sseClients ? { clients: sseClients, frames, latP50Ms: pct(lat, 50), latP95Ms: pct(lat, 95) } : null,
            memoryMB: { rss: +(mem.rss / 1048576).toFixed(1), heap: +(mem.heapUsed / 1048576).toFixed(1) }
        };
    } finally {
        //teardown on every path - a throw mid-run must not leak the listening
        //server, the collector's UDP socket, or the SSE clients (node:test
        //would hang on the live handles); the original error rethrows
        eld.disable();
        collector.stop();
        sseReqs.forEach(r => r.destroy());
        sseAgent.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
};
