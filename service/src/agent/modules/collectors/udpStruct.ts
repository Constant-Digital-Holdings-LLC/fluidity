import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData } from '#@shared/types.js';
import { DataCollector, DataCollectorParams } from '../collectors.js';
import { decodeFluPacket, FluDropReason, FLU_DEFAULT_PORT } from '../udpCodec.js';
import dgram from 'node:dgram';

const conf = await confFromFS();

const log = fetchLogger(conf);

export interface UdpStructCollectorParams extends DataCollectorParams {
    port?: number;
    bind?: string;
}

//bad-time is not a drop (the packet is accepted, re-stamped); it shares the
//counter surface so a device with a wild clock is just as visible
type UdpCountReason = FluDropReason | 'bad-time';

//per-source log damping (UDP-SPEC s6): the reason counters always increment,
//but a chattering source logs its first few drops and then every 100th
const DAMP_AFTER = 5;
const DAMP_EVERY = 100;
//spoofed source floods must not grow the damping table without bound; once
//full, new sources are counted but never logged (the noisiest case is
//exactly when the log must stay quiet)
const MAX_SOURCES = 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

export default class UdpStructCollector extends DataCollector {
    private readonly port: number;
    private readonly bindAddr: string | undefined;
    private readonly siteFromPacket: boolean;
    private readonly socket: dgram.Socket;
    private readonly bound: Promise<number>;
    private readonly counts = new Map<UdpCountReason, number>();
    private readonly sourceDrops = new Map<string, number>();
    private sourceTableFull = false;

    constructor(params: UdpStructCollectorParams) {
        super(params);

        const { port, bind } = params;

        //0 binds an ephemeral port (test seam; the bound port is logged)
        if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
            throw new Error(`udpStruct [${params.description}]: port must be an integer 0..65535`);
        }
        this.port = port ?? FLU_DEFAULT_PORT;

        if (bind !== undefined && typeof bind !== 'string') {
            throw new Error(`udpStruct [${params.description}]: bind must be an interface address string`);
        }
        this.bindAddr = bind;

        const eo = params.extendedOptions;

        //MAC mode is milestone U2: a config that asks for authentication must
        //refuse to run open, never silently accept unauthenticated traffic
        if (eo && typeof eo === 'object' && ('secret' in eo || 'requireMac' in eo)) {
            throw new Error(
                `udpStruct [${params.description}]: secret/requireMac (MAC mode) is not implemented yet (U2) - ` +
                    `remove it to run in open mode`
            );
        }

        let siteFromPacket = true;
        if (eo && typeof eo === 'object' && 'siteFromPacket' in eo && eo.siteFromPacket !== undefined) {
            if (typeof eo.siteFromPacket === 'boolean') {
                siteFromPacket = eo.siteFromPacket;
            } else {
                log.warn(
                    `udpStruct [${params.description}]: invalid siteFromPacket in extendedOptions ` +
                        `(must be boolean) - defaulting to true`
                );
            }
        }
        this.siteFromPacket = siteFromPacket;

        this.socket = dgram.createSocket(this.bindAddr?.includes(':') ? 'udp6' : 'udp4');
        this.bound = new Promise((resolve, reject) => {
            this.socket.once('listening', () => resolve(this.socket.address().port));
            this.socket.once('error', reject);
        });
        this.bound.catch(() => undefined); //observed via ready(); never unhandled
    }

    //counter surface shared with the hardened srsSerial collector
    public get dropCounts(): ReadonlyMap<string, number> {
        return this.counts;
    }

    //resolves with the bound port once listening (tests bind port 0)
    public ready(): Promise<number> {
        return this.bound;
    }

    start(): void {
        this.socket.on('error', err => {
            log.error(`udpStruct [${this.params.description}]: socket error: ${err.message}`);
        });

        this.socket.on('message', (msg, rinfo) => this.ingest(msg, rinfo));

        this.socket.on('listening', () => {
            const { address, port } = this.socket.address();
            log.info(`started: ${this.params.plugin} [${this.params.description}] on udp ${address}:${port}`);
            log.info(
                `udpStruct [${this.params.description}]: open mode - no MAC required; ` +
                    `keep this port LAN-only (UDP-SPEC s4)`
            );
        });

        this.socket.bind(this.port, this.bindAddr);
    }

    override stop(): void {
        try {
            this.socket.close();
        } catch {
            //never bound (start not called, or bind failed): nothing to release
        }
    }

    //datagrams arrive here, not via the line-oriented send() path
    format(): FormattedData[] | null {
        return null;
    }

    private note(reason: UdpCountReason, rinfo: dgram.RemoteInfo, bytes: number, accepted = false): void {
        const n = (this.counts.get(reason) ?? 0) + 1;
        this.counts.set(reason, n);

        //damping is keyed by address alone: a rebooting device changes its
        //ephemeral source port every boot and must not dodge the damper
        const source = rinfo.address;
        let s = this.sourceDrops.get(source);
        if (s === undefined && this.sourceDrops.size >= MAX_SOURCES) {
            if (!this.sourceTableFull) {
                this.sourceTableFull = true;
                log.warn(
                    `udpStruct [${this.params.description}]: drop-source table full ` +
                        `(${MAX_SOURCES} addresses) - drops from new sources are counted but not logged`
                );
            }
            return;
        }
        s = (s ?? 0) + 1;
        this.sourceDrops.set(source, s);

        if (s <= DAMP_AFTER || s % DAMP_EVERY === 0) {
            log.debug(
                `udpStruct [${this.params.description}]: ${accepted ? 'flagged' : 'dropped'} datagram ` +
                    `(${reason} #${n}) from ${source}:${rinfo.port}, ${bytes} bytes` +
                    `${s > DAMP_AFTER ? ` (source total ${s}, damped)` : ''}`
            );
        }
    }

    private ingest(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        const result = decodeFluPacket(msg);

        if (!result.ok) {
            this.note(result.reason, rinfo, msg.length);
            return;
        }

        const p = result.packet;

        //s3.4: device time is honored only within +-24h of agent time; a wild
        //clock is counted and the packet re-stamped, preserving display order
        let ts: string | undefined;
        if (p.tsEpochMs !== null) {
            if (Math.abs(p.tsEpochMs - Date.now()) <= DAY_MS) {
                ts = new Date(p.tsEpochMs).toISOString();
            } else {
                this.note('bad-time', rinfo, msg.length, true);
            }
        }

        const formattedData: FormattedData[] = p.fields.map(f => ({
            suggestStyle: f.style,
            field: f.text,
            fieldType: 'STRING'
        }));

        //s7 mapping: identity comes from the datagram (site only when
        //siteFromPacket, the default); empty description renders as plugin
        this.sendPacket(formattedData, {
            site: this.siteFromPacket ? p.site : this.params.site,
            plugin: p.plugin,
            description: p.description || p.plugin,
            ts: ts ?? new Date().toISOString(),
            rawData: this.params.keepRaw ? msg.toString('hex') : null
        });
    }
}
