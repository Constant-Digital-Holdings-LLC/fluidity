import dgram from 'node:dgram';
import { pathToFileURL } from 'node:url';
import { mulberry32 } from './prng.js';
import { siphash24, sipKeyFromHex } from './siphash.js';
const packName = (buf, offset, width, text) => {
    const bytes = Buffer.from(text, 'utf8');
    bytes.copy(buf, offset, 0, Math.min(bytes.length, width));
};
export const packFluPacket = (p) => {
    const count = Math.min(Math.max(p.fields.length, 1), 4);
    const buf = Buffer.alloc(61 + count * 42);
    buf.write('FLU1', 0, 'latin1');
    buf[4] = 1;
    buf[5] = p.tsEpochSec !== undefined ? 0x01 : 0x00;
    buf.writeUInt16LE(p.deviceSeq & 0xffff, 6);
    buf.writeUInt32LE(Math.floor(p.tsEpochSec ?? 0), 8);
    packName(buf, 12, 16, p.site);
    packName(buf, 28, 16, p.plugin);
    packName(buf, 44, 16, p.description ?? '');
    buf[60] = count;
    p.fields.slice(0, count).forEach((f, i) => {
        const base = 61 + i * 42;
        buf[base] = f.style & 0xff;
        packName(buf, base + 2, 40, f.text);
    });
    return buf;
};
const makeFleet = () => {
    let temp = 21.0;
    let rh = 62;
    let level = 78;
    let doorOpen = false;
    return [
        {
            site: 'greenhouse',
            plugin: 'm5-env',
            description: 'soil probe',
            heartbeatMs: { min: 8000, max: 14000 },
            seq: 0,
            hasClock: true,
            fields(rng) {
                temp = Math.min(34, Math.max(12, temp + (rng() - 0.5) * 0.8));
                rh = Math.min(95, Math.max(25, rh + (rng() - 0.5) * 3));
                return [
                    { style: 2, text: `temp ${temp.toFixed(1)}C` },
                    { style: 7, text: `rh ${Math.round(rh)}%` }
                ];
            }
        },
        {
            site: 'gate-1',
            plugin: 'avr-door',
            description: 'driveway',
            heartbeatMs: { min: 9000, max: 16000 },
            seq: 0,
            hasClock: false,
            fields(rng) {
                if (rng() < 0.2)
                    doorOpen = !doorOpen;
                return doorOpen ? [{ style: 5, text: 'OPEN' }] : [{ style: 10, text: 'closed' }];
            }
        },
        {
            site: 'water-tank',
            plugin: 'arm-level',
            description: 'north tank',
            heartbeatMs: { min: 10000, max: 18000 },
            seq: 0,
            hasClock: false,
            fields(rng) {
                level -= rng() * 2;
                if (level < 20)
                    level = 96;
                return [
                    { style: 3, text: `level ${Math.round(level)}%` },
                    { style: 9, text: level < 35 ? 'pump due' : 'nominal' }
                ];
            }
        }
    ];
};
export const signFluPacket = (struct, key) => {
    const signed = Buffer.from(struct);
    signed[5] = (signed[5] ?? 0) | 0x02;
    return Buffer.concat([signed, Buffer.from(siphash24(key, signed))]);
};
export const startUdpFleet = (options) => {
    const host = options?.host ?? '127.0.0.1';
    const port = options?.port ?? 17996;
    const rng = mulberry32(options?.seed ?? Math.floor(Math.random() * 0xffffffff));
    const fleet = makeFleet();
    let key;
    if (options?.secret !== undefined) {
        const parsed = sipKeyFromHex(options.secret);
        if (!parsed)
            throw new Error('udpDeviceSim: secret must be 32 hex chars (openssl rand -hex 16)');
        key = parsed;
    }
    const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    socket.on('error', () => undefined);
    socket.unref();
    let stopped = false;
    const timers = new Set();
    const fire = (dev) => new Promise(resolve => {
        const pkt = packFluPacket({
            site: dev.site,
            plugin: dev.plugin,
            description: dev.description,
            deviceSeq: dev.seq,
            ...(dev.hasClock ? { tsEpochSec: Math.floor(Date.now() / 1000) } : {}),
            fields: dev.fields(rng)
        });
        dev.seq = (dev.seq + 1) & 0xffff;
        socket.send(key ? signFluPacket(pkt, key) : pkt, port, host, () => resolve());
    });
    const schedule = (dev) => {
        if (stopped)
            return;
        const { min, max } = dev.heartbeatMs;
        const timer = setTimeout(() => {
            timers.delete(timer);
            void fire(dev)
                .catch(() => undefined)
                .finally(() => schedule(dev));
        }, min + Math.floor(rng() * (max - min)));
        timers.add(timer);
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        timers.forEach(t => clearTimeout(t));
        timers.clear();
        socket.close();
    };
    let done;
    if (options?.once) {
        done = Promise.all(fleet.map(fire)).then(() => stop());
    }
    else {
        done = Promise.all(fleet.map(fire)).then(() => {
            fleet.forEach(schedule);
        });
    }
    return { stop, done };
};
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const arg = (name) => {
        const i = process.argv.indexOf(`--${name}`);
        return i !== -1 ? process.argv[i + 1] : undefined;
    };
    const once = process.argv.includes('--once');
    const port = Number(arg('port') ?? 17996);
    const host = arg('host') ?? '127.0.0.1';
    const seedArg = arg('seed');
    const secret = arg('secret');
    const fleet = startUdpFleet({
        host,
        port,
        once,
        ...(seedArg ? { seed: Number(seedArg) } : {}),
        ...(secret ? { secret } : {})
    });
    console.log(`udpDeviceSim: 3-device fleet -> udp ${host}:${port}${secret ? ' (signed)' : ''}${once ? ' (once)' : ''}`);
    if (once) {
        void fleet.done.then(() => console.log('udpDeviceSim: burst sent'));
    }
    else {
        process.on('SIGINT', () => {
            fleet.stop();
            process.exit(0);
        });
        setInterval(() => undefined, 60_000);
    }
}
//# sourceMappingURL=udpDeviceSim.js.map