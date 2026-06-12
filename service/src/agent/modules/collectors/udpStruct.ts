import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData } from '#@shared/types.js';
import { siphash24, macEqual, sipKeyFromHex } from '#@sims/siphash.js';
import { DataCollector, DataCollectorParams, extOpt } from '../collectors.js';
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
//backpressure is a drop: the upstream HTTPS path is saturated.
type UdpCountReason = FluDropReason | 'bad-time' | 'unsigned' | 'replay' | 'backpressure';

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

//re-anchoring on any coherent reject pair would let a captured signed pair
//steal the anchor and replay a whole captured run; an arbitrary-seq coherent
//run must instead sustain this many consecutive rejects before the window
//re-anchors (recovery for a device whose boot burst the agent missed)
const RECOVERY_STREAK = 8;

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
    private readonly sourceDrops = new Map<string, number>();
    private readonly seqState = new Map<string, { last: number; lastReject: number | null; rejectStreak: number }>();
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

        const secret = extOpt(eo, 'secret');
        if (secret !== undefined) {
            const parsed = typeof secret === 'string' ? sipKeyFromHex(secret) : null;
            if (!parsed) {
                throw new Error(
                    `udpStruct [${params.description}]: secret must be exactly 32 hex chars ` +
                        `(a 16-byte SipHash key; generate one with: openssl rand -hex 16)`
                );
            }
            key = parsed;
        }

        const requireMacOpt = extOpt(eo, 'requireMac');
        if (requireMacOpt !== undefined) {
            if (typeof requireMacOpt !== 'boolean') {
                throw new Error(`udpStruct [${params.description}]: requireMac must be a boolean`);
            }
            requireMac = requireMacOpt;
        }

        const rw = extOpt(eo, 'replayWindow');
        if (rw !== undefined) {
            if (typeof rw !== 'number' || !Number.isInteger(rw) || rw < 1 || rw > 1024) {
                throw new Error(`udpStruct [${params.description}]: replayWindow must be an integer 1..1024`);
            }
            replayWindow = rw;
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
        //missing-trailer policy lives in the codec (§6 step 5) so unsigned
        //datagrams in MAC mode drop as bad-mac before the structural checks
        this.decodeOpts = key
            ? { verifyMac: (signed, mac): boolean => macEqual(siphash24(key, signed), mac), requireMac }
            : undefined;

        let siteFromPacket = true;
        const sfp = extOpt(eo, 'siteFromPacket');
        if (sfp !== undefined) {
            if (typeof sfp === 'boolean') {
                siteFromPacket = sfp;
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

    //resolves with the bound port once listening (tests bind port 0)
    public ready(): Promise<number> {
        return this.bound;
    }

    start(): void {
        this.socket.on('error', err => {
            //a bind failure (EADDRINUSE/EACCES) lands here, not as a throw; make
            //it loud - this collector's ingest is dead, though other collectors
            //in the agent keep running
            log.error(
                `udpStruct [${this.params.description}]: socket error on udp ${this.bindAddr ?? '0.0.0.0'}:${this.port} ` +
                    `- UDP ingest for this collector is offline: ${err.message}`
            );
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
        //counts live on the DataCollector base (one surface for all collectors)
        const n = this.noteDrop(reason);

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
    //are rejected; the window re-anchors on a *coherent* reject run (each
    //reject advancing 1..window past the previous), but only when the run is
    //consistent with a device reset (low absolute seq) or has persisted for
    //RECOVERY_STREAK rejects. A reboot therefore costs one packet and
    //firmware needs no persistent counter, while a captured signed pair can
    //no longer steal the anchor and replay a whole captured run - an
    //arbitrary-seq replay must burn RECOVERY_STREAK datagrams per steal and
    //the genuine feed re-anchors back the same way. Residual exposure
    //(documented in the spec): replay of a capture of the device's first
    //~2xwindow packets after a boot.
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
            this.seqState.set(id, { last: p.deviceSeq, lastReject: null, rejectStreak: 0 });
            return true;
        }

        const delta = (p.deviceSeq - st.last) & 0xffff;
        if (delta >= 1 && delta <= win) {
            st.last = p.deviceSeq;
            st.lastReject = null;
            st.rejectStreak = 0;
            return true;
        }

        if (st.lastReject !== null) {
            const stride = (p.deviceSeq - st.lastReject) & 0xffff;
            if (stride >= 1 && stride <= win) {
                st.rejectStreak++;
                //a device counting up from reset re-enters at a low seq; an
                //arbitrary-seq coherent run must persist before it re-anchors
                if (p.deviceSeq <= 2 * win || st.rejectStreak >= RECOVERY_STREAK) {
                    st.last = p.deviceSeq;
                    st.lastReject = null;
                    st.rejectStreak = 0;
                    log.info(
                        `udpStruct [${this.params.description}]: re-anchored seq window for ` +
                            `${p.site}/${p.plugin} at ${p.deviceSeq} (device reset?)`
                    );
                    return true;
                }
                st.lastReject = p.deviceSeq;
                return false;
            }
            st.rejectStreak = 0;
        }
        st.lastReject = p.deviceSeq;
        st.rejectStreak = 1;
        return false;
    }

    private ingest(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        const result = decodeFluPacket(msg, this.decodeOpts);

        //migration mode counts every unsigned datagram (s6 step 5) - the
        //malformed ones too, which the codec reports via hasMac on failures;
        //in MAC mode the codec itself drops missing trailers as bad-mac
        const hasMac = result.ok ? result.packet.hasMac : result.hasMac;
        if (this.key && !this.requireMac && hasMac === false) {
            this.note('unsigned', rinfo, msg.length, result.ok);
        }

        if (!result.ok) {
            this.note(result.reason, rinfo, msg.length);
            return;
        }

        const p = result.packet;

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

        //the base class bounds the upstream backlog and would shed this
        //packet anyway; checking first lets the drop carry its source
        //address into the counters like every other UDP drop reason
        if (this.upstreamSaturated) {
            this.note('backpressure', rinfo, msg.length);
            return;
        }

        //s7 mapping: identity comes from the datagram (site only when
        //siteFromPacket, the default); empty description renders as plugin
        void this.sendPacket(formattedData, {
            site: this.siteFromPacket ? p.site : this.params.site,
            plugin: p.plugin,
            description: p.description || p.plugin,
            ts: ts ?? new Date().toISOString(),
            rawData: this.params.keepRaw ? msg.toString('hex') : null
        });
    }
}
