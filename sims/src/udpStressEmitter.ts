//UDP stress emitter: a rate-controlled, seed-deterministic barrage for
//exercising the udpStruct collector's decode/drop/backpressure paths at
//volume - the udpDeviceSim fleet is paced for realism (heartbeats), this
//is paced for load. Sender-side counts are exact (count-driven, not
//time-driven), so tests can reconcile what was sent against what the
//collector counted; the gap between the two IS the loopback/kernel loss.
//
//Categories:
//  valid    - well-formed packet from a rotating device pool (signed when
//             a secret is given)
//  garbage  - seeded-random bytes, 1..260 long (decoder must drop them all)
//  tampered - signed, then one payload byte flipped (bad-mac; needs secret)
//  unsigned - well-formed but no trailer (bad-mac under requireMac;
//             'unsigned' in migration mode; needs secret to be meaningful)

import dgram from 'node:dgram';
import { arg, isMain } from './cliArgs.js';
import { Rng, mulberry32 } from './prng.js';
import { sipKeyFromHex } from './siphash.js';
import { packFluPacket, signFluPacket } from './udpDeviceSim.js';

export type StressCategory = 'valid' | 'garbage' | 'tampered' | 'unsigned';

export interface UdpStressOptions {
    host?: string; //default 127.0.0.1
    port?: number; //default 17996
    rate?: number; //target packets/sec (default 1000)
    durationSec?: number; //default 5; total sent = round(rate * durationSec), exact
    devices?: number; //distinct site identities, stress-1..N (default 50)
    mix?: Partial<Record<StressCategory, number>>; //weights; default { valid: 100 }
    secret?: string; //32 hex chars; signs valid (and is required by tampered/unsigned)
    seed?: number;
}

export interface StressReport {
    totalSent: number;
    perCategory: Record<StressCategory, number>;
    sendErrors: number;
    elapsedMs: number;
    achievedPps: number;
    targetPps: number;
    devices: number;
}

export interface StressHandle {
    done: Promise<StressReport>;
    stop(): void; //finish early; done resolves with what was sent so far
}

export const CATEGORIES: StressCategory[] = ['valid', 'garbage', 'tampered', 'unsigned'];

//parse a --mix spec like "valid:70,garbage:30". Every entry must name a known
//category and carry a finite, non-negative weight; anything else throws, so a
//typo ("vaild:70") fails loudly instead of producing a zero-traffic run.
export const parseMix = (spec: string): Partial<Record<StressCategory, number>> => {
    const mix: Partial<Record<StressCategory, number>> = {};
    for (const part of spec.split(',')) {
        const [name, weight] = part.split(':');
        const w = Number(weight);
        if (!name || !CATEGORIES.includes(name as StressCategory) || !Number.isFinite(w) || w < 0) {
            throw new Error(
                `bad mix entry "${part}" (want e.g. valid:70,garbage:30; categories: ${CATEGORIES.join(', ')})`
            );
        }
        mix[name as StressCategory] = w;
    }
    return mix;
};

export const runUdpStress = (options?: UdpStressOptions): StressHandle => {
    const host = options?.host ?? '127.0.0.1';
    const port = options?.port ?? 17996;
    const rate = options?.rate ?? 1000;
    const durationSec = options?.durationSec ?? 5;
    const deviceCount = options?.devices ?? 50;
    const total = Math.max(1, Math.round(rate * durationSec));
    const rng: Rng = mulberry32(options?.seed ?? Math.floor(Math.random() * 0xffffffff));

    if (!Number.isFinite(rate) || rate < 1) throw new Error('udp-stress: rate must be >= 1');
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('udp-stress: duration must be > 0');
    //a NaN/out-of-range port would sync-throw from socket.send mid-run
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('udp-stress: port must be an integer 1..65535');
    }
    if (!Number.isInteger(deviceCount) || deviceCount < 1 || deviceCount > 10_000) {
        throw new Error('udp-stress: devices must be an integer 1..10000');
    }

    let key: Uint8Array | undefined;
    if (options?.secret !== undefined) {
        const parsed = sipKeyFromHex(options.secret);
        if (!parsed) throw new Error('udp-stress: secret must be 32 hex chars (openssl rand -hex 16)');
        key = parsed;
    }

    const mix = options?.mix ?? { valid: 100 };
    const weights = CATEGORIES.map(c => {
        const w = mix[c] ?? 0;
        if (!Number.isFinite(w) || w < 0) throw new Error(`udp-stress: mix weight for ${c} must be >= 0`);
        return w;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) throw new Error('udp-stress: mix must include at least one positive weight');
    if (!key && ((mix.tampered ?? 0) > 0 || (mix.unsigned ?? 0) > 0)) {
        throw new Error('udp-stress: tampered/unsigned traffic needs a secret (there is nothing to mis-sign)');
    }

    const seqs = new Array<number>(deviceCount).fill(0);

    const pickCategory = (): StressCategory => {
        let roll = rng() * totalWeight;
        for (let i = 0; i < CATEGORIES.length; i++) {
            roll -= weights[i] ?? 0;
            if (roll < 0) return CATEGORIES[i] as StressCategory;
        }
        return 'valid';
    };

    const buildValid = (signed: boolean): Buffer => {
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

    const build = (cat: StressCategory): Buffer => {
        if (cat === 'garbage') {
            const len = 1 + Math.floor(rng() * 260);
            const buf = Buffer.alloc(len);
            for (let b = 0; b < len; b++) buf[b] = Math.floor(rng() * 256);
            return buf;
        }
        if (cat === 'tampered') {
            const wire = buildValid(true);
            wire[70] = (wire[70] ?? 0) ^ 0x01; //one payload bit: the trailer no longer matches
            return wire;
        }
        if (cat === 'unsigned') return buildValid(false);
        return buildValid(key !== undefined);
    };

    const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    socket.on('error', () => undefined);
    socket.unref();

    const perCategory: Record<StressCategory, number> = { valid: 0, garbage: 0, tampered: 0, unsigned: 0 };
    let dispatched = 0;
    let completed = 0;
    let sendErrors = 0;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const t0 = Date.now();

    let resolveDone: (r: StressReport) => void;
    const done = new Promise<StressReport>(resolve => (resolveDone = resolve));

    //safety: never wedge a caller on a lost send callback (cleared by finish)
    const failsafe = setTimeout(
        () => {
            stopped = true;
            completed = dispatched;
            maybeFinish();
        },
        durationSec * 3000 + 2000
    );
    failsafe.unref();

    let finished = false;
    const finish = (): void => {
        if (finished) return; //late send callbacks and the failsafe both land here
        finished = true;
        if (timer) clearTimeout(timer);
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

    const maybeFinish = (): void => {
        if ((stopped || dispatched >= total) && completed >= dispatched) finish();
    };

    const sendOne = (): void => {
        const cat = pickCategory();
        perCategory[cat]++;
        dispatched++;
        socket.send(build(cat), port, host, err => {
            if (err) sendErrors++;
            completed++;
            maybeFinish();
        });
    };

    //time-based catch-up pacing: each tick sends what the clock says is due,
    //capped to ~20ms worth so a stalled event loop never converts into one
    //mega-burst (self-inflicted loopback loss would pollute the measurement)
    const burstCap = Math.max(1, Math.ceil(rate / 50));
    const tick = (): void => {
        if (stopped) {
            maybeFinish();
            return;
        }
        const due = Math.min(total, Math.floor(((Date.now() - t0) / 1000) * rate));
        let burst = Math.min(due - dispatched, burstCap);
        while (burst-- > 0) sendOne();
        if (dispatched >= total) {
            maybeFinish();
            return;
        }
        timer = setTimeout(tick, 5);
    };
    tick();

    return {
        done,
        stop: (): void => {
            stopped = true;
            maybeFinish();
        }
    };
};

//CLI: node sims/dist/udpStressEmitter.js [--port N] [--host H] [--rate PPS]
//  [--duration SEC] [--devices N] [--mix valid:70,garbage:20,tampered:10]
//  [--secret HEX32] [--seed N]
if (isMain(import.meta.url)) {
    let mix: Partial<Record<StressCategory, number>> | undefined;
    const mixArg = arg('mix');
    if (mixArg) {
        try {
            mix = parseMix(mixArg);
        } catch (err) {
            console.error(`udp-stress: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(2);
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
        ...(mix ? { mix } : {}),
        ...(secret ? { secret } : {}),
        ...(seed ? { seed: Number(seed) } : {})
    });

    process.on('SIGINT', () => handle.stop());

    void handle.done.then(r => {
        const cats = CATEGORIES.map(c => `${c} ${r.perCategory[c]}`).join(' | ');
        console.log(
            `udp-stress: sent ${r.totalSent} in ${(r.elapsedMs / 1000).toFixed(2)}s ` +
                `(${r.achievedPps} pps of ${r.targetPps} target, ${r.devices} devices)`
        );
        console.log(`  ${cats} | send-errors ${r.sendErrors}`);
        console.log('  compare against the collector: sum(dropCounts) + published ~= delivered');
    });
}
