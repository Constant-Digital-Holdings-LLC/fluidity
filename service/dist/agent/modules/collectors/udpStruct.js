import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { DataCollector } from '../collectors.js';
import { decodeFluPacket, FLU_DEFAULT_PORT } from '../udpCodec.js';
import dgram from 'node:dgram';
const conf = await confFromFS();
const log = fetchLogger(conf);
const DAMP_AFTER = 5;
const DAMP_EVERY = 100;
const MAX_SOURCES = 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
export default class UdpStructCollector extends DataCollector {
    port;
    bindAddr;
    siteFromPacket;
    socket;
    bound;
    counts = new Map();
    sourceDrops = new Map();
    sourceTableFull = false;
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
        if (eo && typeof eo === 'object' && ('secret' in eo || 'requireMac' in eo)) {
            throw new Error(`udpStruct [${params.description}]: secret/requireMac (MAC mode) is not implemented yet (U2) - ` +
                `remove it to run in open mode`);
        }
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
            log.info(`udpStruct [${this.params.description}]: open mode - no MAC required; ` +
                `keep this port LAN-only (UDP-SPEC s4)`);
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
    ingest(msg, rinfo) {
        const result = decodeFluPacket(msg);
        if (!result.ok) {
            this.note(result.reason, rinfo, msg.length);
            return;
        }
        const p = result.packet;
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
        this.sendPacket(formattedData, {
            site: this.siteFromPacket ? p.site : this.params.site,
            plugin: p.plugin,
            description: p.description || p.plugin,
            ts: ts ?? new Date().toISOString(),
            rawData: this.params.keepRaw ? msg.toString('hex') : null
        });
    }
}
