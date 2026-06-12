//UDP device-fleet simulator (UDP-SPEC s9): a few LAN microcontrollers
//publishing flu_packet_v1 datagrams - heartbeats plus occasional events -
//from a seeded PRNG, exactly as sim://srs stands in for a real controller.
//
//packFluPacket below is a deliberately independent implementation of the
//wire format (the firmware reference, transliterated from the C struct in
//UDP-SPEC s3). It must NOT import the agent codec: the test suite proves
//the two implementations agree byte-for-byte, which is worth far more than
//sharing the code.

import dgram from 'node:dgram';
import { arg, isMain } from './cliArgs.js';
import { Rng, mulberry32 } from './prng.js';
import { siphash24, sipKeyFromHex } from './siphash.js';

export interface FluSimField {
    style: number;
    text: string;
}

export interface FluSimPacket {
    site: string;
    plugin: string;
    description?: string;
    deviceSeq: number;
    tsEpochSec?: number; //sets the FLU_F_TS flag
    fields: FluSimField[];
}

//strncpy semantics, like firmware: silently truncated at the field width
const packName = (buf: Buffer, offset: number, width: number, text: string): void => {
    const bytes = Buffer.from(text, 'utf8');
    bytes.copy(buf, offset, 0, Math.min(bytes.length, width));
};

export const packFluPacket = (p: FluSimPacket): Buffer => {
    const count = Math.min(Math.max(p.fields.length, 1), 4);
    const buf = Buffer.alloc(61 + count * 42);

    buf.write('FLU1', 0, 'latin1'); //magic, LE u32 0x31554C46
    buf[4] = 1; //version
    buf[5] = p.tsEpochSec !== undefined ? 0x01 : 0x00; //flags: FLU_F_TS only
    buf.writeUInt16LE(p.deviceSeq & 0xffff, 6);
    buf.writeUInt32LE(Math.floor(p.tsEpochSec ?? 0), 8);
    packName(buf, 12, 16, p.site);
    packName(buf, 28, 16, p.plugin);
    packName(buf, 44, 16, p.description ?? '');
    buf[60] = count;

    p.fields.slice(0, count).forEach((f, i) => {
        const base = 61 + i * 42;
        buf[base] = f.style & 0xff;
        //base + 1 reserved = 0
        packName(buf, base + 2, 40, f.text);
    });

    return buf;
};

//a simulated device: holds its own seq counter and wandering sensor state
interface SimDevice {
    site: string;
    plugin: string;
    description: string;
    heartbeatMs: { min: number; max: number };
    seq: number;
    hasClock: boolean;
    fields(rng: Rng): FluSimField[];
}

const makeFleet = (): SimDevice[] => {
    let temp = 21.0;
    let rh = 62;
    let level = 78;
    let doorOpen = false;

    return [
        {
            //ESP32 with NTP: ships device time (FLU_F_TS)
            site: 'greenhouse',
            plugin: 'm5-env',
            description: 'soil probe',
            heartbeatMs: { min: 8000, max: 14000 },
            seq: 0,
            hasClock: true,
            fields(rng: Rng): FluSimField[] {
                temp = Math.min(34, Math.max(12, temp + (rng() - 0.5) * 0.8));
                rh = Math.min(95, Math.max(25, rh + (rng() - 0.5) * 3));
                return [
                    { style: 2, text: `temp ${temp.toFixed(1)}C` },
                    { style: 7, text: `rh ${Math.round(rh)}%` }
                ];
            }
        },
        {
            //8-bit AVR, clockless: the agent stamps arrival time
            site: 'gate-1',
            plugin: 'avr-door',
            description: 'driveway',
            heartbeatMs: { min: 9000, max: 16000 },
            seq: 0,
            hasClock: false,
            fields(rng: Rng): FluSimField[] {
                if (rng() < 0.2) doorOpen = !doorOpen;
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
            fields(rng: Rng): FluSimField[] {
                level -= rng() * 2;
                if (level < 20) level = 96; //pump kicks in
                return [
                    { style: 3, text: `level ${Math.round(level)}%` },
                    { style: 9, text: level < 35 ? 'pump due' : 'nominal' }
                ];
            }
        }
    ];
};

//device-side signing reference (UDP-SPEC s4), exactly what firmware does:
//set FLU_F_MAC, SipHash-2-4 the whole struct (flags included), append the
//8-byte trailer
export const signFluPacket = (struct: Uint8Array, key: Uint8Array): Buffer => {
    const signed = Buffer.from(struct);
    signed[5] = (signed[5] ?? 0) | 0x02; //FLU_F_MAC
    return Buffer.concat([signed, Buffer.from(siphash24(key, signed))]);
};

export interface UdpFleetOptions {
    host?: string; //default 127.0.0.1
    port?: number; //default 17996 (FLU_DEFAULT_PORT)
    seed?: number;
    once?: boolean; //one datagram per device, then stop (smoke scripts)
    secret?: string; //32 hex chars: sign every datagram (MAC mode devices)
    //override every device's heartbeat cadence (the defaults are 8-18s, true
    //to real telemetry); set a small range for fast demos and tests
    heartbeatMs?: { min: number; max: number };
}

export interface UdpFleetHandle {
    stop(): void;
    //resolves when a once-mode burst has been flushed (rejects never)
    done: Promise<void>;
}

export const startUdpFleet = (options?: UdpFleetOptions): UdpFleetHandle => {
    const host = options?.host ?? '127.0.0.1';
    const port = options?.port ?? 17996;
    //a bad port would otherwise surface as a sync throw from socket.send
    //inside fire(), breaking the done-never-rejects contract
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('udpDeviceSim: port must be an integer 1..65535');
    }
    const rng = mulberry32(options?.seed ?? Math.floor(Math.random() * 0xffffffff));
    const fleet = makeFleet();

    let key: Uint8Array | undefined;
    if (options?.secret !== undefined) {
        const parsed = sipKeyFromHex(options.secret);
        if (!parsed) throw new Error('udpDeviceSim: secret must be 32 hex chars (openssl rand -hex 16)');
        key = parsed;
    }

    const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    socket.on('error', () => undefined); //fire-and-forget, like the devices
    socket.unref();

    let stopped = false;
    const timers = new Set<NodeJS.Timeout>();

    const fire = (dev: SimDevice): Promise<void> =>
        new Promise(resolve => {
            const pkt = packFluPacket({
                site: dev.site,
                plugin: dev.plugin,
                description: dev.description,
                deviceSeq: dev.seq,
                ...(dev.hasClock ? { tsEpochSec: Math.floor(Date.now() / 1000) } : {}),
                fields: dev.fields(rng)
            });
            dev.seq = (dev.seq + 1) & 0xffff;
            //socket.send can also throw synchronously (closed socket, bad
            //args); done is contracted to never reject, so a failed send is
            //just a lost datagram - resolve and move on
            try {
                socket.send(key ? signFluPacket(pkt, key) : pkt, port, host, () => resolve());
            } catch {
                resolve();
            }
        });

    const schedule = (dev: SimDevice): void => {
        if (stopped) return;
        const { min, max } = options?.heartbeatMs ?? dev.heartbeatMs;
        const timer = setTimeout(
            () => {
                timers.delete(timer);
                //reschedule whether or not the send settled cleanly: a transient
                //send error must not silently end this device's heartbeat.
                //schedule() no-ops once stopped, so this can't spin after stop().
                void fire(dev)
                    .catch(() => undefined)
                    .finally(() => schedule(dev));
            },
            min + Math.floor(rng() * (max - min))
        );
        timers.add(timer);
    };

    const stop = (): void => {
        if (stopped) return;
        stopped = true;
        timers.forEach(t => clearTimeout(t));
        timers.clear();
        socket.close();
    };

    let done: Promise<void>;
    if (options?.once) {
        done = Promise.all(fleet.map(fire)).then(() => stop());
    } else {
        //an immediate first packet per device, then each on its own cadence
        done = Promise.all(fleet.map(fire)).then(() => {
            fleet.forEach(schedule);
        });
    }

    return { stop, done };
};

//CLI for dev demos:
//node sims/dist/udpDeviceSim.js [--port N] [--host H] [--seed N] [--secret HEX32] [--once]
if (isMain(import.meta.url)) {
    const once = process.argv.includes('--once');
    const port = Number(arg('port') ?? 17996);
    const host = arg('host') ?? '127.0.0.1';
    const seedArg = arg('seed');
    const secret = arg('secret');

    let fleet: UdpFleetHandle;
    try {
        fleet = startUdpFleet({
            host,
            port,
            once,
            ...(seedArg ? { seed: Number(seedArg) } : {}),
            ...(secret ? { secret } : {})
        });
    } catch (err) {
        //bad port/secret: a clear one-liner and exit 2, not a stack trace
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
    }

    console.log(
        `udpDeviceSim: 3-device fleet -> udp ${host}:${port}${secret ? ' (signed)' : ''}${once ? ' (once)' : ''}`
    );

    if (once) {
        void fleet.done.then(() => console.log('udpDeviceSim: burst sent'));
    } else {
        process.on('SIGINT', () => {
            fleet.stop();
            process.exit(0);
        });
        //keep the process alive; the socket itself is unref'd
        setInterval(() => undefined, 60_000);
    }
}
