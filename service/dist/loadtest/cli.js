import { fileURLToPath } from 'node:url';
import { arg } from '#@sims/cliArgs.js';
import { parseMix } from '#@sims/udpStressEmitter.js';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const numFlag = (name) => {
    const raw = arg(name);
    if (raw === undefined)
        return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        console.error(`loadtest: --${name} must be a number, got "${raw ?? ''}"`);
        process.exit(2);
    }
    return n;
};
const opts = {};
const rate = numFlag('rate');
if (rate !== undefined)
    opts.rate = rate;
const duration = numFlag('duration');
if (duration !== undefined)
    opts.durationSec = duration;
const devices = numFlag('devices');
if (devices !== undefined)
    opts.devices = devices;
const throttle = numFlag('throttle');
if (throttle !== undefined)
    opts.throttle = throttle;
const sse = numFlag('sse');
if (sse !== undefined)
    opts.sseClients = sse;
const secret = arg('secret');
if (secret)
    opts.secret = secret;
const seed = numFlag('seed');
if (seed !== undefined)
    opts.seed = seed;
const mixArg = arg('mix');
if (mixArg) {
    try {
        opts.mix = parseMix(mixArg);
    }
    catch (err) {
        console.error(`loadtest: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(2);
    }
}
console.log(`loadtest: ${opts.rate ?? 5000} pps for ${opts.durationSec ?? 5}s, ` +
    `mix ${mixArg ?? 'valid:100'}${opts.secret ? ' (MAC mode)' : ''}` +
    `${opts.sseClients ? `, ${opts.sseClients} SSE subscribers` : ''} ...`);
const { runLoadtest } = await import('./harness.js');
const r = await runLoadtest(opts);
const pad = (s) => s.padEnd(16);
console.log('');
console.log(`${pad('offered')} ${r.offered} datagrams (${r.offeredPps} pps achieved by the emitter)`);
console.log(`${pad('forwarded')} ${r.server.posts} reached the server FIFO/SSE`);
console.log(`${pad('drops')} ${JSON.stringify(r.agent.drops)}`);
console.log(`${pad('backpressure')} ${r.agent.shed} shed (upstream saturated)`);
console.log(`${pad('event loop')} mean ${r.agent.loopMeanMs}ms, max ${r.agent.loopMaxMs}ms`);
console.log(`${pad('memory')} rss ${r.memoryMB.rss}MB, heap ${r.memoryMB.heap}MB`);
if (r.sse) {
    console.log(`${pad('sse fanout')} ${r.sse.clients} subs, ${r.sse.frames} frames, lat p50 ${r.sse.latP50Ms}ms / p95 ${r.sse.latP95Ms}ms`);
}
console.log('');
console.log('note: loopback UDP sheds part of any unpaced burst at the kernel; the');
console.log('agent processes what the socket delivers. Raise the offered rate or run');
console.log('parallel CLIs to push harder. Real ceilings are well above any device fleet.');
