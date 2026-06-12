//`npm run loadtest` entry. Parses flags, runs the e2e harness, prints a report.
//
//  npm run loadtest -- --rate 20000 --duration 10 --mix valid:70,garbage:30
//  npm run loadtest -- --rate 8000 --secret <hex32> --sse 16      (MAC mode)
//  npm run loadtest -- --rate 50000 --mix garbage:100             (decode ceiling)
//
//For a CPU profile, run it directly under the profiler from service/dist/agent:
//  cd service/dist/agent && node --cpu-prof --cpu-prof-dir=/tmp ../loadtest/cli.js --rate 20000

import { fileURLToPath } from 'node:url';
import type { LoadtestOptions } from './harness.js';
import type { StressCategory } from '#@sims/udpStressEmitter.js';

//the udpStruct collector loads its logger config from cwd at import time;
//run from this module's dir (which ships a logLevel:never conf) so a load run
//and any CPU profile aren't drowned in per-packet debug output. Must happen
//before the dynamic import of the harness, which pulls in the collector.
process.chdir(fileURLToPath(new URL('.', import.meta.url)));

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : undefined;
};

//validate numeric flags at the edge so a typo reports clearly here, rather
//than surfacing as a downstream "NaN" or a cryptic emitter throw
const numFlag = (name: string): number | undefined => {
    const raw = flag(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        console.error(`loadtest: --${name} must be a number, got "${raw ?? ''}"`);
        process.exit(2);
    }
    return n;
};

const opts: LoadtestOptions = {};
const rate = numFlag('rate');
if (rate !== undefined) opts.rate = rate;
const duration = numFlag('duration');
if (duration !== undefined) opts.durationSec = duration;
const devices = numFlag('devices');
if (devices !== undefined) opts.devices = devices;
const throttle = numFlag('throttle');
if (throttle !== undefined) opts.throttle = throttle;
const sse = numFlag('sse');
if (sse !== undefined) opts.sseClients = sse;
const secret = flag('secret');
if (secret) opts.secret = secret;
const seed = numFlag('seed');
if (seed !== undefined) opts.seed = seed;

const mixArg = flag('mix');
if (mixArg) {
    const mix: Partial<Record<StressCategory, number>> = {};
    for (const part of mixArg.split(',')) {
        const [k, w] = part.split(':');
        if (k) mix[k as StressCategory] = Number(w);
    }
    opts.mix = mix;
}

console.log(
    `loadtest: ${opts.rate ?? 5000} pps for ${opts.durationSec ?? 5}s, ` +
        `mix ${mixArg ?? 'valid:100'}${opts.secret ? ' (MAC mode)' : ''}` +
        `${opts.sseClients ? `, ${opts.sseClients} SSE subscribers` : ''} ...`
);

const { runLoadtest } = await import('./harness.js');
const r = await runLoadtest(opts);

const pad = (s: string): string => s.padEnd(16);
console.log('');
console.log(`${pad('offered')} ${r.offered} datagrams (${r.offeredPps} pps achieved by the emitter)`);
console.log(`${pad('forwarded')} ${r.server.posts} reached the server FIFO/SSE`);
console.log(`${pad('drops')} ${JSON.stringify(r.agent.drops)}`);
console.log(`${pad('backpressure')} ${r.agent.shed} shed (upstream saturated)`);
console.log(`${pad('event loop')} mean ${r.agent.loopMeanMs}ms, max ${r.agent.loopMaxMs}ms`);
console.log(`${pad('memory')} rss ${r.memoryMB.rss}MB, heap ${r.memoryMB.heap}MB`);
if (r.sse) {
    console.log(
        `${pad('sse fanout')} ${r.sse.clients} subs, ${r.sse.frames} frames, lat p50 ${r.sse.latP50Ms}ms / p95 ${r.sse.latP95Ms}ms`
    );
}
console.log('');
console.log('note: loopback UDP sheds part of any unpaced burst at the kernel; the');
console.log('agent processes what the socket delivers. Raise the offered rate or run');
console.log('parallel CLIs to push harder. Real ceilings are well above any device fleet.');
