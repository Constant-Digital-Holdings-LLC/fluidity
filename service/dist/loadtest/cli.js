import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : undefined;
};
const opts = {};
if (flag('rate'))
    opts.rate = Number(flag('rate'));
if (flag('duration'))
    opts.durationSec = Number(flag('duration'));
if (flag('devices'))
    opts.devices = Number(flag('devices'));
if (flag('throttle'))
    opts.throttle = Number(flag('throttle'));
if (flag('sse'))
    opts.sseClients = Number(flag('sse'));
const secret = flag('secret');
if (secret)
    opts.secret = secret;
if (flag('seed'))
    opts.seed = Number(flag('seed'));
const mixArg = flag('mix');
if (mixArg) {
    const mix = {};
    for (const part of mixArg.split(',')) {
        const [k, w] = part.split(':');
        if (k)
            mix[k] = Number(w);
    }
    opts.mix = mix;
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
