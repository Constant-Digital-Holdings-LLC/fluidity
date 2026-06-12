import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData } from '#@shared/types.js';
import { siphash24, macEqual, sipKeyFromHex } from '#@sims/siphash.js';
import { DataCollector, DataCollectorParams } from '../collectors.js';
import { decodeFluPacket, FluDecoded, FluDecodeOptions, FluDropReason, FLU_DEFAULT_PORT } from '../udpCodec.js';
import dgram from 'node:dgram';

const conf = await confFromFS();

const log = fetchLogger(conf);

export interface UdpStructCollectorParams extends DataCollectorParams {
    port?: number;
    bind?: string;
}

//bad-time and unsigned are not drops (the packet is accepted); they share
//the counter surface so a wild clock or an unmigrated device is just as
//visible. replay is a drop: an authentic-but-stale sequence number.
type UdpCountReason = FluDropReason | 'bad-time' | 'unsigned' | 'replay';

//per-source log damping (UDP-SPEC s6): the reason counters always increment,
//but a chattering source logs its first few drops and then every 100th
const DAMP_AFTER = 5;
const DAMP_EVERY = 100;
//spoofed source floods must not grow the damping table without bound; once
//full, new sources are counted but never logged (the noisiest case is
//exactly when the log must stay quiet)
const MAX_SOURCES = 1024;

//replay-window device table cap; beyond it the window fails OPEN, because
//every packet reaching it carried a valid MAC - whoever fills the table
//holds the shared secret and the window is moot anyway
const MAX_DEVICES = 4096;

const DAY_MS = 24 * 60 * 60 * 1000;

export default class UdpStructCollector extends DataCollector {
    private readonly port: number;
    private readonly bindAddr: string | undefined;
    private readonly siteFromPacket: boolean;
    private readonly key: Uint8Array | undefined;
    private readonly requireMac: boolean;
    private readonly replayWindow: number | undefined;
    private readonly decodeOpts: FluDecodeOptions | undefined;
    private readonly socket: dgram.Socket;
    private readonly bound: Promise<number>;
    private readonly counts = new Map<UdpCountReason, number>();
    private readonly sourceDrops = new Map<string, number>();
    private readonly seqState = new Map<string, { last: number; lastReject: number | null }>();
    private sourceTableFull = false;
    private seqTableFull = false;

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

        //authentication config degrades LOUDLY: any misconfigured security
        //option refuses to start - warn-and-fallback would silently weaken
        //the very thing the operator asked for
        let key: Uint8Array | undefined;
        let requireMac = false;
        let replayWindow: number | undefined;

        if (eo && typeof eo === 'object') {
            if ('secret' in eo && eo.secret !== undefined) {
                const parsed = typeof eo.secret === 'string' ? sipKeyFromHex(eo.secret) : null;
                if (!parsed) {
                    throw new Error(
                        `udpStruct [${params.description}]: secret must be exactly 32 hex chars ` +
                            `(a 16-byte SipHash key; generate one with: openssl rand -hex 16)`
                    );
                }
                key = parsed;
            }

            if ('requireMac' in eo && eo.requireMac !== undefined) {
                if (typeof eo.requireMac !== 'boolean') {
                    throw new Error(`udpStruct [${params.description}]: requireMac must be a boolean`);
                }
                requireMac = eo.requireMac;
            }

            if ('replayWindow' in eo && eo.replayWindow !== undefined) {
                const rw = eo.replayWindow;
                if (typeof rw !== 'number' || !Number.isInteger(rw) || rw < 1 || rw > 1024) {
                    throw new Error(`udpStruct [${params.description}]: replayWindow must be an integer 1..1024`);
                }
                replayWindow = rw;
            }
        }

        if (requireMac && !key) {
            throw new Error(`udpStruct [${params.description}]: requireMac needs a secret to verify against`);
        }
        if (replayWindow !== undefined && !key) {
            throw new Error(
                `udpStruct [${params.description}]: replayWindow needs a secret - ` +
                    `sequence numbers are forgeable without a MAC`
            );
        }

        this.key = key;
        this.requireMac = requireMac;
        this.replayWindow = replayWindow;
        this.decodeOpts = key
            ? { verifyMac: (signed, mac): boolean => macEqual(siphash24(key, signed), mac) }
            : undefined;

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

            //the security posture is one glance at the log, always
            if (!this.key) {
                log.info(
                    `udpStruct [${this.params.description}]: open mode - no MAC required; ` +
                        `keep this port LAN-only (UDP-SPEC s4)`
                );
            } else if (this.requireMac) {
                log.info(
                    `udpStruct [${this.params.description}]: MAC mode - SipHash-2-4 trailer required` +
                        (this.replayWindow !== undefined ? `, replay window ${this.replayWindow}` : '')
                );
            } else {
                log.info(
                    `udpStruct [${this.params.description}]: migration mode - MACs verified when present, ` +
                        `unsigned packets accepted and counted (set requireMac:true to enforce)`
                );
            }
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

    //strict device_seq window (UDP-SPEC s4, resolved decision 3): accept only
    //seqs advancing 1..window past the anchor, mod 2^16. Out-of-window seqs
    //are rejected, but two *coherent* consecutive rejects (the second
    //advancing 1..window past the first - a device counting up from a reset)
    //re-anchor the window, so a reboot costs exactly one packet and firmware
    //needs no persistent counter. Known limit, documented in the spec: a
    //captured consecutive signed pair can force one stale line through.
    private acceptSeq(p: FluDecoded): boolean {
        const win = this.replayWindow ?? 0;
        //NUL separator cannot collide: the codec strips control chars from names
        const id = `${p.site}\u0000${p.plugin}`;
        const st = this.seqState.get(id);

        if (!st) {
            if (this.seqState.size >= MAX_DEVICES) {
                if (!this.seqTableFull) {
                    this.seqTableFull = true;
                    log.warn(
                        `udpStruct [${this.params.description}]: replay-window device table full ` +
                            `(${MAX_DEVICES}) - failing open for new identities (all carried valid MACs)`
                    );
                }
                return true;
            }
            this.seqState.set(id, { last: p.deviceSeq, lastReject: null });
            return true;
        }

        const delta = (p.deviceSeq - st.last) & 0xffff;
        if (delta >= 1 && delta <= win) {
            st.last = p.deviceSeq;
            st.lastReject = null;
            return true;
        }

        if (st.lastReject !== null) {
            const stride = (p.deviceSeq - st.lastReject) & 0xffff;
            if (stride >= 1 && stride <= win) {
                st.last = p.deviceSeq; //second coherent reject: device reset, re-anchor
                st.lastReject = null;
                return true;
            }
        }
        st.lastReject = p.deviceSeq;
        return false;
    }

    private ingest(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        const result = decodeFluPacket(msg, this.decodeOpts);

        if (!result.ok) {
            this.note(result.reason, rinfo, msg.length);
            return;
        }

        const p = result.packet;

        //MAC presence policy (s4): in MAC mode a missing trailer is as bad as
        //a wrong one; in migration mode it is accepted and counted 'unsigned'
        if (this.key && !p.hasMac) {
            if (this.requireMac) {
                this.note('bad-mac', rinfo, msg.length);
                return;
            }
            this.note('unsigned', rinfo, msg.length, true);
        }

        //replay window applies only to MAC-verified packets - an unsigned
        //sequence number is an attacker-chosen value, not evidence
        if (this.replayWindow !== undefined && this.key && p.hasMac && !this.acceptSeq(p)) {
            this.note('replay', rinfo, msg.length);
            return;
        }

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
