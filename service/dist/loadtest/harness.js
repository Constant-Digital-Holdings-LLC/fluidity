import https from 'node:https';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { makeApp } from '../server/modules/expressApp.js';
import UdpStructCollector from '../agent/modules/collectors/udpStruct.js';
import { runUdpStress } from '#@sims/udpStressEmitter.js';
const sslPath = (f) => fileURLToPath(new URL(`../server/ssl/${f}`, import.meta.url));
const pct = (arr, p) => {
    if (!arr.length)
        return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
export const runLoadtest = async (opts = {}) => {
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
        logLevel: 'never',
        permittedKeys: ['loadtestkey1'],
        maxServerHistory: 300
    };
    let posts = 0;
    const server = https.createServer(tls, makeApp(conf));
    server.on('request', req => {
        if (req.method === 'POST')
            posts++;
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const serverPort = server.address().port;
    const sseAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
    const lat = [];
    let frames = 0;
    const sseReqs = [];
    for (let i = 0; i < sseClients; i++) {
        const measure = i === 0;
        const req = https.request({ host: '127.0.0.1', port: serverPort, path: '/SSE', method: 'GET', agent: sseAgent }, res => {
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
                    if (!line)
                        continue;
                    frames++;
                    if (!measure)
                        continue;
                    try {
                        const ts = Date.parse(JSON.parse(line.slice(6)).ts);
                        if (!Number.isNaN(ts))
                            lat.push(Date.now() - ts);
                    }
                    catch {
                    }
                }
            });
        });
        req.on('error', () => undefined);
        req.end();
        sseReqs.push(req);
    }
    if (sseClients)
        await sleep(200);
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
    const report = await runUdpStress({
        port: udpPort,
        rate,
        durationSec,
        devices: opts.devices ?? 50,
        mix: opts.mix ?? { valid: 100 },
        ...(secret ? { secret } : {}),
        seed: opts.seed ?? 0xc0ffee
    }).done;
    await sleep(1500);
    eld.disable();
    const drops = {};
    for (const [k, v] of collector.dropCounts)
        drops[k] = v;
    const shed = (drops['backpressure'] ?? 0) + collector.backpressureShed;
    delete drops['backpressure'];
    const mem = process.memoryUsage();
    collector.stop();
    sseReqs.forEach(r => r.destroy());
    sseAgent.destroy();
    await new Promise(resolve => server.close(() => resolve()));
    return {
        offered: report.totalSent,
        offeredPps: report.achievedPps,
        durationSec,
        agent: {
            processed: posts,
            drops,
            shed,
            loopMeanMs: +(eld.mean / 1e6).toFixed(2),
            loopMaxMs: +(eld.max / 1e6).toFixed(2)
        },
        server: { posts },
        sse: sseClients ? { clients: sseClients, frames, latP50Ms: pct(lat, 50), latP95Ms: pct(lat, 95) } : null,
        memoryMB: { rss: +(mem.rss / 1048576).toFixed(1), heap: +(mem.heapUsed / 1048576).toFixed(1) }
    };
};
