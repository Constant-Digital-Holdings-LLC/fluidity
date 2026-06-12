import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { siphash24, macEqual, sipKeyFromHex } from '#@sims/siphash.js';
import { DataCollector } from '../collectors.js';
import { decodeFluPacket, FLU_DEFAULT_PORT } from '../udpCodec.js';
import dgram from 'node:dgram';
const conf = await confFromFS();
const log = fetchLogger(conf);
const DAMP_AFTER = 5;
const DAMP_EVERY = 100;
const MAX_SOURCES = 1024;
const MAX_DEVICES = 4096;
const DAY_MS = 24 * 60 * 60 * 1000;
export default class UdpStructCollector extends DataCollector {
    port;
    bindAddr;
    siteFromPacket;
    key;
    requireMac;
    replayWindow;
    decodeOpts;
    socket;
    bound;
    counts = new Map();
    sourceDrops = new Map();
    seqState = new Map();
    sourceTableFull = false;
    seqTableFull = false;
    constructor(params) {
        super(params);
        const { port, bind } = params;
        if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
            throw new Error(`udpStruct [${params.description}]: port must be an integer 0..65535`);
        }
        this.port = port ?? FLU_DEFAULT_PORT;
        if (bind !== undefined && typeof bind !== 'string') {
            throw new Error(`udpStruct [${params.description}]: bind must be an interface address string`);
        }
        this.bindAddr = bind;
        const eo = params.extendedOptions;
        let key;
        let requireMac = false;
        let replayWindow;
        if (eo && typeof eo === 'object') {
            if ('secret' in eo && eo.secret !== undefined) {
                const parsed = typeof eo.secret === 'string' ? sipKeyFromHex(eo.secret) : null;
                if (!parsed) {
                    throw new Error(`udpStruct [${params.description}]: secret must be exactly 32 hex chars ` +
                        `(a 16-byte SipHash key; generate one with: openssl rand -hex 16)`);
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
            throw new Error(`udpStruct [${params.description}]: replayWindow needs a secret - ` +
                `sequence numbers are forgeable without a MAC`);
        }
        this.key = key;
        this.requireMac = requireMac;
        this.replayWindow = replayWindow;
        this.decodeOpts = key
            ? { verifyMac: (signed, mac) => macEqual(siphash24(key, signed), mac) }
            : undefined;
        let siteFromPacket = true;
        if (eo && typeof eo === 'object' && 'siteFromPacket' in eo && eo.siteFromPacket !== undefined) {
            if (typeof eo.siteFromPacket === 'boolean') {
                siteFromPacket = eo.siteFromPacket;
            }
            else {
                log.warn(`udpStruct [${params.description}]: invalid siteFromPacket in extendedOptions ` +
                    `(must be boolean) - defaulting to true`);
            }
        }
        this.siteFromPacket = siteFromPacket;
        this.socket = dgram.createSocket(this.bindAddr?.includes(':') ? 'udp6' : 'udp4');
        this.bound = new Promise((resolve, reject) => {
            this.socket.once('listening', () => resolve(this.socket.address().port));
            this.socket.once('error', reject);
        });
        this.bound.catch(() => undefined);
    }
    get dropCounts() {
        return this.counts;
    }
    ready() {
        return this.bound;
    }
    start() {
        this.socket.on('error', err => {
            log.error(`udpStruct [${this.params.description}]: socket error: ${err.message}`);
        });
        this.socket.on('message', (msg, rinfo) => this.ingest(msg, rinfo));
        this.socket.on('listening', () => {
            const { address, port } = this.socket.address();
            log.info(`started: ${this.params.plugin} [${this.params.description}] on udp ${address}:${port}`);
            if (!this.key) {
                log.info(`udpStruct [${this.params.description}]: open mode - no MAC required; ` +
                    `keep this port LAN-only (UDP-SPEC s4)`);
            }
            else if (this.requireMac) {
                log.info(`udpStruct [${this.params.description}]: MAC mode - SipHash-2-4 trailer required` +
                    (this.replayWindow !== undefined ? `, replay window ${this.replayWindow}` : ''));
            }
            else {
                log.info(`udpStruct [${this.params.description}]: migration mode - MACs verified when present, ` +
                    `unsigned packets accepted and counted (set requireMac:true to enforce)`);
            }
        });
        this.socket.bind(this.port, this.bindAddr);
    }
    stop() {
        try {
            this.socket.close();
        }
        catch {
        }
    }
    format() {
        return null;
    }
    note(reason, rinfo, bytes, accepted = false) {
        const n = (this.counts.get(reason) ?? 0) + 1;
        this.counts.set(reason, n);
        const source = rinfo.address;
        let s = this.sourceDrops.get(source);
        if (s === undefined && this.sourceDrops.size >= MAX_SOURCES) {
            if (!this.sourceTableFull) {
                this.sourceTableFull = true;
                log.warn(`udpStruct [${this.params.description}]: drop-source table full ` +
                    `(${MAX_SOURCES} addresses) - drops from new sources are counted but not logged`);
            }
            return;
        }
        s = (s ?? 0) + 1;
        this.sourceDrops.set(source, s);
        if (s <= DAMP_AFTER || s % DAMP_EVERY === 0) {
            log.debug(`udpStruct [${this.params.description}]: ${accepted ? 'flagged' : 'dropped'} datagram ` +
                `(${reason} #${n}) from ${source}:${rinfo.port}, ${bytes} bytes` +
                `${s > DAMP_AFTER ? ` (source total ${s}, damped)` : ''}`);
        }
    }
    acceptSeq(p) {
        const win = this.replayWindow ?? 0;
        const id = `${p.site}\u0000${p.plugin}`;
        const st = this.seqState.get(id);
        if (!st) {
            if (this.seqState.size >= MAX_DEVICES) {
                if (!this.seqTableFull) {
                    this.seqTableFull = true;
                    log.warn(`udpStruct [${this.params.description}]: replay-window device table full ` +
                        `(${MAX_DEVICES}) - failing open for new identities (all carried valid MACs)`);
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
                st.last = p.deviceSeq;
                st.lastReject = null;
                return true;
            }
        }
        st.lastReject = p.deviceSeq;
        return false;
    }
    ingest(msg, rinfo) {
        const result = decodeFluPacket(msg, this.decodeOpts);
        if (!result.ok) {
            this.note(result.reason, rinfo, msg.length);
            return;
        }
        const p = result.packet;
        if (this.key && !p.hasMac) {
            if (this.requireMac) {
                this.note('bad-mac', rinfo, msg.length);
                return;
            }
            this.note('unsigned', rinfo, msg.length, true);
        }
        if (this.replayWindow !== undefined && this.key && p.hasMac && !this.acceptSeq(p)) {
            this.note('replay', rinfo, msg.length);
            return;
        }
        let ts;
        if (p.tsEpochMs !== null) {
            if (Math.abs(p.tsEpochMs - Date.now()) <= DAY_MS) {
                ts = new Date(p.tsEpochMs).toISOString();
            }
            else {
                this.note('bad-time', rinfo, msg.length, true);
            }
        }
        const formattedData = p.fields.map(f => ({
            suggestStyle: f.style,
            field: f.text,
            fieldType: 'STRING'
        }));
        if (this.upstreamSaturated) {
            this.note('backpressure', rinfo, msg.length);
            return;
        }
        void this.sendPacket(formattedData, {
            site: this.siteFromPacket ? p.site : this.params.site,
            plugin: p.plugin,
            description: p.description || p.plugin,
            ts: ts ?? new Date().toISOString(),
            rawData: this.params.keepRaw ? msg.toString('hex') : null
        });
    }
}
