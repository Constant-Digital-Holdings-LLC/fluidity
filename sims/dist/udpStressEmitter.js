import dgram from 'node:dgram';
import { pathToFileURL } from 'node:url';
import { mulberry32 } from './prng.js';
import { sipKeyFromHex } from './siphash.js';
import { packFluPacket, signFluPacket } from './udpDeviceSim.js';
const CATEGORIES = ['valid', 'garbage', 'tampered', 'unsigned'];
export const runUdpStress = (options) => {
    const host = options?.host ?? '127.0.0.1';
    const port = options?.port ?? 17996;
    const rate = options?.rate ?? 1000;
    const durationSec = options?.durationSec ?? 5;
    const deviceCount = options?.devices ?? 50;
    const total = Math.max(1, Math.round(rate * durationSec));
    const rng = mulberry32(options?.seed ?? Math.floor(Math.random() * 0xffffffff));
    if (!Number.isFinite(rate) || rate < 1)
        throw new Error('udp-stress: rate must be >= 1');
    if (!Number.isInteger(deviceCount) || deviceCount < 1 || deviceCount > 10_000) {
        throw new Error('udp-stress: devices must be an integer 1..10000');
    }
    let key;
    if (options?.secret !== undefined) {
        const parsed = sipKeyFromHex(options.secret);
        if (!parsed)
            throw new Error('udp-stress: secret must be 32 hex chars (openssl rand -hex 16)');
        key = parsed;
    }
    const mix = options?.mix ?? { valid: 100 };
    const weights = CATEGORIES.map(c => {
        const w = mix[c] ?? 0;
        if (!Number.isFinite(w) || w < 0)
            throw new Error(`udp-stress: mix weight for ${c} must be >= 0`);
        return w;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0)
        throw new Error('udp-stress: mix must include at least one positive weight');
    if (!key && ((mix.tampered ?? 0) > 0 || (mix.unsigned ?? 0) > 0)) {
        throw new Error('udp-stress: tampered/unsigned traffic needs a secret (there is nothing to mis-sign)');
    }
    const seqs = new Array(deviceCount).fill(0);
    const pickCategory = () => {
        let roll = rng() * totalWeight;
        for (let i = 0; i < CATEGORIES.length; i++) {
            roll -= weights[i] ?? 0;
            if (roll < 0)
                return CATEGORIES[i];
        }
        return 'valid';
    };
    const buildValid = (signed) => {
        const dev = Math.floor(rng() * deviceCount);
        const seq = seqs[dev] ?? 0;
        seqs[dev] = (seq + 1) & 0xffff;
        const pkt = packFluPacket({
            site: `stress-${dev + 1}`,
            plugin: 'udp-stress',
            description: 'load test',
            deviceSeq: seq,
            fields: [{ style: dev % 11, text: `n ${seq}` }]
        });
        return signed && key ? signFluPacket(pkt, key) : pkt;
    };
    const build = (cat) => {
        if (cat === 'garbage') {
            const len = 1 + Math.floor(rng() * 260);
            const buf = Buffer.alloc(len);
            for (let b = 0; b < len; b++)
                buf[b] = Math.floor(rng() * 256);
            return buf;
        }
        if (cat === 'tampered') {
            const wire = buildValid(true);
            wire[70] = (wire[70] ?? 0) ^ 0x01;
            return wire;
        }
        if (cat === 'unsigned')
            return buildValid(false);
        return buildValid(key !== undefined);
    };
    const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    socket.on('error', () => undefined);
    socket.unref();
    const perCategory = { valid: 0, garbage: 0, tampered: 0, unsigned: 0 };
    let dispatched = 0;
    let completed = 0;
    let sendErrors = 0;
    let stopped = false;
    let timer;
    const t0 = Date.now();
    let resolveDone;
    const done = new Promise(resolve => (resolveDone = resolve));
    const failsafe = setTimeout(() => {
        stopped = true;
        completed = dispatched;
        maybeFinish();
    }, durationSec * 3000 + 2000);
    failsafe.unref();
    let finished = false;
    const finish = () => {
        if (finished)
            return;
        finished = true;
        if (timer)
            clearTimeout(timer);
        clearTimeout(failsafe);
        socket.close();
        const elapsedMs = Math.max(1, Date.now() - t0);
        resolveDone({
            totalSent: dispatched,
            perCategory,
            sendErrors,
            elapsedMs,
            achievedPps: Math.round((dispatched / elapsedMs) * 1000),
            targetPps: rate,
            devices: deviceCount
        });
    };
    const maybeFinish = () => {
        if ((stopped || dispatched >= total) && completed >= dispatched)
            finish();
    };
    const sendOne = () => {
        const cat = pickCategory();
        perCategory[cat]++;
        dispatched++;
        socket.send(build(cat), port, host, err => {
            if (err)
                sendErrors++;
            completed++;
            maybeFinish();
        });
    };
    const burstCap = Math.max(1, Math.ceil(rate / 50));
    const tick = () => {
        if (stopped) {
            maybeFinish();
            return;
        }
        const due = Math.min(total, Math.floor(((Date.now() - t0) / 1000) * rate));
        let burst = Math.min(due - dispatched, burstCap);
        while (burst-- > 0)
            sendOne();
        if (dispatched >= total) {
            maybeFinish();
            return;
        }
        timer = setTimeout(tick, 5);
    };
    tick();
    return {
        done,
        stop: () => {
            stopped = true;
            maybeFinish();
        }
    };
};
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const arg = (name) => {
        const i = process.argv.indexOf(`--${name}`);
        return i !== -1 ? process.argv[i + 1] : undefined;
    };
    const mixArg = arg('mix');
    const mix = {};
    if (mixArg) {
        for (const part of mixArg.split(',')) {
            const [name, weight] = part.split(':');
            if (!name || !CATEGORIES.includes(name) || Number.isNaN(Number(weight))) {
                console.error(`udp-stress: bad mix entry "${part}" (want e.g. valid:70,garbage:30)`);
                process.exit(2);
            }
            mix[name] = Number(weight);
        }
    }
    const secret = arg('secret');
    const seed = arg('seed');
    const handle = runUdpStress({
        host: arg('host') ?? '127.0.0.1',
        port: Number(arg('port') ?? 17996),
        rate: Number(arg('rate') ?? 1000),
        durationSec: Number(arg('duration') ?? 5),
        devices: Number(arg('devices') ?? 50),
        ...(mixArg ? { mix } : {}),
        ...(secret ? { secret } : {}),
        ...(seed ? { seed: Number(seed) } : {})
    });
    process.on('SIGINT', () => handle.stop());
    void handle.done.then(r => {
        const cats = CATEGORIES.map(c => `${c} ${r.perCategory[c]}`).join(' | ');
        console.log(`udp-stress: sent ${r.totalSent} in ${(r.elapsedMs / 1000).toFixed(2)}s ` +
            `(${r.achievedPps} pps of ${r.targetPps} target, ${r.devices} devices)`);
        console.log(`  ${cats} | send-errors ${r.sendErrors}`);
        console.log('  compare against the collector: sum(dropCounts) + published ~= delivered');
    });
}
//# sourceMappingURL=udpStressEmitter.js.map