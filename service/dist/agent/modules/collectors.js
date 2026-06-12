import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort, SerialPortMock } from 'serialport';
import { simProfileFromPath, startFeeder } from '#@sims/index.js';
import { isFfluidityPacket, isApiKeyFormat, isFluidityLink, isObject } from '#@shared/types.js';
import { nodeEnv } from '#@shared/modules/utils.js';
import { throttledQueue } from 'throttled-queue';
const conf = await confFromFS();
const log = fetchLogger(conf);
import https from 'https';
import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { parseTokenizeConfig, toFields } from './tokenize.js';
const NODE_ENV = nodeEnv();
const MAX_PENDING_POSTS_ABS = 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const SERIAL_REOPEN_MS = 5_000;
const LOG_FLEET_DEFAULT_THROTTLE = 1000;
const TAIL_POLL_MS_DEFAULT = 300;
const TAIL_CHUNK_BYTES = 64 * 1024;
const TAIL_MAX_LINE_BYTES_DEFAULT = 64 * 1024;
const TAIL_MULTILINE_MAX_LINES = 500;
const TAIL_MULTILINE_FLUSH_MS = 1000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const shouldVerifyTLS = (hostname) => !(NODE_ENV === 'development' && LOOPBACK_HOSTS.has(hostname));
export const extOpt = (eo, key) => eo && key in eo ? eo[key] : undefined;
export const isDataCollectorParams = (item) => {
    const { targets, keepRaw, extendedOptions } = item;
    return (isFfluidityPacket(item, true) &&
        Array.isArray(targets) &&
        Boolean(targets.length) &&
        (typeof keepRaw === 'undefined' || typeof keepRaw === 'boolean') &&
        (typeof extendedOptions === 'undefined' || isObject(extendedOptions)));
};
export class FormatHelper {
    formattedData = [];
    e(element, suggestStyle) {
        suggestStyle ??= 0;
        if (typeof element === 'string') {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'STRING' });
        }
        else if (isFluidityLink(element)) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'LINK' });
        }
        else if (element instanceof Date) {
            this.formattedData.push({ suggestStyle, field: element.toISOString(), fieldType: 'DATE' });
        }
        else {
            this.formattedData.push({ suggestStyle, field: element.toString(), fieldType: 'STRING' });
        }
        return this;
    }
    get done() {
        const out = this.formattedData;
        this.formattedData = [];
        return out;
    }
}
const isSysError = (e) => {
    return (isObject(e) &&
        'errno' in e &&
        typeof e.errno === 'number' &&
        'code' in e &&
        typeof e.code === 'string' &&
        'syscall' in e &&
        typeof e.syscall === 'string');
};
const isHttpError = (e) => {
    return (isSysError(e) && 'address' in e && typeof e.address === 'string' && 'port' in e && typeof e.port === 'number');
};
export class DataCollector {
    params;
    throttle;
    pendingPosts = 0;
    maxPendingPosts;
    shedTotal = 0;
    maxPostsPerSec;
    urlCache = new Map();
    drops = new Map();
    constructor(params) {
        this.params = params;
        if (!isDataCollectorParams(params))
            throw new Error(`DataCollector class constructor - invalid runtime params`);
        const { maxHttpsReqPerCollectorPerSec = 2 } = params;
        this.maxPostsPerSec = maxHttpsReqPerCollectorPerSec;
        log.info(`Agent: maxHttpsReqPerCollectorPerSec: ${maxHttpsReqPerCollectorPerSec}`);
        this.throttle = throttledQueue({ maxPerInterval: maxHttpsReqPerCollectorPerSec, interval: 1000 });
        this.maxPendingPosts = Math.min(MAX_PENDING_POSTS_ABS, Math.max(32, 2 * maxHttpsReqPerCollectorPerSec));
    }
    stop() { }
    urlFor(location) {
        let uo = this.urlCache.get(location);
        if (!uo) {
            uo = new URL(location);
            this.urlCache.set(location, uo);
        }
        return uo;
    }
    noteDrop(reason) {
        const n = (this.drops.get(reason) ?? 0) + 1;
        this.drops.set(reason, n);
        return n;
    }
    get dropCounts() {
        return this.drops;
    }
    _reqJSON(method, uo, data, key) {
        const { protocol, hostname, port, pathname, search } = uo;
        return new Promise((resolve, reject) => {
            if (method === 'POST') {
                if (!key) {
                    reject(new Error(`DataCollector: missing API key for ${uo.toString()}`));
                    return;
                }
                if (!isApiKeyFormat(key)) {
                    reject(new Error(`Invalid key format - API keys should be alphanumeric\nConsider using the bin/genApiKey utility`));
                    return;
                }
            }
            const req = https.request({
                protocol,
                rejectUnauthorized: shouldVerifyTLS(hostname),
                hostname,
                port,
                method: method,
                path: pathname + search,
                timeout: REQUEST_TIMEOUT_MS,
                headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Api-Key': key } : undefined
            }, (res) => {
                res.setEncoding('utf8');
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode === 401) {
                        log.warn('Server responded with: Unauthorized');
                        log.warn('Agent likely using invalidated api-key');
                    }
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    }
                    else {
                        req.end();
                        reject(new Error(`makeReq() non 200 series response (${res.statusCode ?? 'none'})`));
                    }
                });
                res.on('error', () => {
                    req.end();
                    reject(new Error(`makeReq() request error`));
                });
            });
            req.on('timeout', () => {
                req.destroy(new Error(`request to ${hostname} timed out after ${REQUEST_TIMEOUT_MS}ms`));
            });
            req.on('error', e => {
                req.end();
                if (isHttpError(e) && e.code === 'ECONNREFUSED') {
                    reject(new Error(`Connection REFUSED connecting to host ${e.address} on port ${e.port}`));
                }
                else if (isSysError(e) && e.code === 'ECONNRESET') {
                    reject(new Error(`Connection RESET during ${e.syscall}`));
                }
                else {
                    reject(e);
                }
            });
            method === 'POST' && req.write(JSON.stringify(data));
            req.end();
        });
    }
    async get(location) {
        return await this.throttle(async () => {
            return await this._reqJSON('GET', this.urlFor(location));
        });
    }
    async post(location, data, key) {
        return await this.throttle(async () => {
            return await this._reqJSON('POST', this.urlFor(location), data, key);
        });
    }
    async sendHttps(targets, fPacket) {
        log.debug(targets);
        log.debug(fPacket);
        for (const { location, key } of targets) {
            try {
                await this.post(location, fPacket, key);
            }
            catch (err) {
                log.error(err);
            }
        }
    }
    dispatch(fPacket) {
        if (this.pendingPosts >= this.maxPendingPosts) {
            this.shedTotal++;
            if (this.shedTotal <= 5 || this.shedTotal % 100 === 0) {
                log.warn(`${this.params.plugin} [${this.params.description}]: upstream saturated ` +
                    `(${this.pendingPosts} posts in flight) - shedding newest packet (total shed ${this.shedTotal})`);
            }
            return Promise.resolve();
        }
        this.pendingPosts++;
        return this.sendHttps(this.params.targets, fPacket)
            .catch(err => {
            log.warn(err);
        })
            .finally(() => {
            this.pendingPosts--;
        });
    }
    get upstreamSaturated() {
        return this.pendingPosts >= this.maxPendingPosts;
    }
    get backpressureShed() {
        return this.shedTotal;
    }
    send(data) {
        const { site, plugin, description, keepRaw } = this.params;
        const formattedData = this.format(data, new FormatHelper());
        if (Array.isArray(formattedData) && formattedData.length) {
            void this.dispatch({
                site,
                plugin,
                description,
                ts: new Date().toISOString(),
                formattedData,
                rawData: keepRaw ? data : null
            });
        }
        else {
            log.debug(`DataCollector: ignoring string: ${data}`);
        }
    }
    sendPacket(formattedData, perPacket = {}) {
        if (!formattedData.length)
            return Promise.resolve();
        const { rawData = null, ...overrides } = perPacket;
        const { site, plugin, description } = this.params;
        return this.dispatch({
            site,
            plugin,
            description,
            ts: new Date().toISOString(),
            formattedData,
            rawData,
            ...overrides
        });
    }
}
export class PollingCollector extends DataCollector {
    pollIntervalSec;
    timer;
    pollStopped = false;
    constructor({ pollIntervalSec, ...params }) {
        super(params);
        if (typeof pollIntervalSec !== 'number' || !Number.isFinite(pollIntervalSec) || pollIntervalSec < 1) {
            throw new Error(`polling collectors require pollIntervalSec >= 1 in constructor ${params.plugin}: ${params.description}`);
        }
        this.pollIntervalSec = pollIntervalSec;
    }
    format(data, fh) {
        return fh.e(data).done;
    }
    start() {
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
        this.runPoll();
    }
    runPoll() {
        try {
            this.execPerInterval();
        }
        catch (err) {
            log.error(err);
        }
        finally {
            if (!this.pollStopped) {
                this.timer = setTimeout(this.runPoll.bind(this), this.pollIntervalSec * 1000);
            }
        }
    }
    stop() {
        this.pollStopped = true;
        if (this.timer)
            clearTimeout(this.timer);
    }
}
export class WebJSONCollector extends PollingCollector {
    url;
    constructor({ url, ...params }) {
        super(params);
        if (typeof url !== 'string') {
            throw new Error(`missing url (string) in config for ${params.plugin}: ${params.description}`);
        }
        this.url = new URL(url);
    }
    execPerInterval() {
        this.get(this.url.href)
            .then(data => {
            log.info(`${this.params.plugin} [${this.params.description}]: contacting host...(${this.url.host})`);
            this.send(data);
        })
            .catch(err => {
            log.error(err);
        });
    }
}
export class SerialCollector extends DataCollector {
    port;
    parser;
    closing = false;
    reopenTimer;
    format(data, fh) {
        return fh.e(data).done;
    }
    openPort(path, baudRate) {
        const onOpenError = (err) => {
            if (err?.stack)
                log.error(err.stack);
        };
        const profile = simProfileFromPath(path);
        if (profile) {
            SerialPortMock.binding.createPort(path);
            const port = new SerialPortMock({ path, baudRate }, onOpenError);
            port.on('open', () => {
                log.info(`${this.params.plugin} [${this.params.description}]: simulating serial device on ${path} (profile: ${profile.name})`);
                const feeder = startFeeder(profile, chunk => port.port?.emitData(chunk));
                port.on('close', () => feeder.stop());
            });
            return port;
        }
        return new SerialPort({ path, baudRate }, onOpenError);
    }
    constructor({ path, baudRate, ...params }) {
        super(params);
        if (typeof path !== 'string')
            throw new Error(`expected serial port identifier (string) in config for ${params.plugin}: ${params.description}`);
        if (typeof baudRate !== 'number')
            throw new Error(`expected numeric port speed in config for ${params.plugin}: ${params.description}`);
        this.port = this.openPort(path, baudRate);
        this.parser = this.port.pipe(this.fetchParser());
        this.port.on('error', err => {
            log.error(`${this.params.plugin} [${this.params.description}]: serial error: ${err.message}`);
        });
        this.parser.on('error', (err) => {
            log.error(`${this.params.plugin} [${this.params.description}]: parser error: ${err.message}`);
        });
        this.port.on('close', (err) => {
            if (this.closing)
                return;
            log.warn(`${this.params.plugin} [${this.params.description}]: serial port closed` +
                `${err ? ` (${err.message})` : ''} - retrying open every ${SERIAL_REOPEN_MS / 1000}s`);
            this.scheduleReopen();
        });
    }
    scheduleReopen() {
        this.reopenTimer = setTimeout(() => {
            if (this.closing)
                return;
            this.port.open(err => {
                if (err) {
                    this.scheduleReopen();
                }
                else {
                    this.port.unpipe(this.parser);
                    this.port.pipe(this.parser);
                    log.info(`${this.params.plugin} [${this.params.description}]: serial port reopened`);
                }
            });
        }, SERIAL_REOPEN_MS);
    }
    start() {
        this.parser.on('data', this.send.bind(this));
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
    }
    stop() {
        this.closing = true;
        if (this.reopenTimer)
            clearTimeout(this.reopenTimer);
        if (this.port.isOpen) {
            this.port.close();
        }
        else {
            this.port.once('open', () => this.port.close());
        }
    }
}
const fileIdentity = (m) => (m.ino && Number.isFinite(m.ino) ? m.ino : m.birthMs);
export class FileTailCollector extends DataCollector {
    path;
    fromStart;
    pollMs;
    maxLineBytes;
    pos = 0;
    identity;
    decoder = new StringDecoder('utf8');
    lineBuf = '';
    atStart = false;
    timer;
    stopped = false;
    polling = false;
    tok;
    ml;
    entryLines = [];
    entryAt = 0;
    constructor({ path, fromStart, pollIntervalMs, maxLineBytes, multiline, ...params }) {
        super({
            ...params,
            maxHttpsReqPerCollectorPerSec: params.maxHttpsReqPerCollectorPerSec ?? LOG_FLEET_DEFAULT_THROTTLE
        });
        this.tok = parseTokenizeConfig(extOpt(params.extendedOptions, 'tokenize'), true, `logTail [${params.description}]`);
        if (typeof path !== 'string' || !path) {
            throw new Error(`file-tail collector requires a file path (string) for ${params.plugin}: ${params.description}`);
        }
        this.path = path;
        this.fromStart = fromStart === true;
        const pm = pollIntervalMs ?? TAIL_POLL_MS_DEFAULT;
        if (typeof pm !== 'number' || !Number.isFinite(pm) || pm < 50) {
            throw new Error(`file-tail collector pollIntervalMs must be a number >= 50 (${params.description})`);
        }
        this.pollMs = pm;
        const mlb = maxLineBytes ?? TAIL_MAX_LINE_BYTES_DEFAULT;
        if (typeof mlb !== 'number' || !Number.isInteger(mlb) || mlb < 1) {
            throw new Error(`file-tail collector maxLineBytes must be a positive integer (${params.description})`);
        }
        this.maxLineBytes = mlb;
        this.ml = this.parseMultiline(multiline, params.description);
    }
    parseMultiline(raw, desc) {
        if (raw === undefined || raw === false)
            return null;
        const cfg = raw === true ? {} : raw;
        if (!isObject(cfg))
            throw new Error(`logTail [${desc}]: multiline must be a boolean or an object`);
        const o = cfg;
        let startRe;
        if (o.startPattern !== undefined) {
            if (typeof o.startPattern !== 'string')
                throw new Error(`logTail [${desc}]: multiline.startPattern must be a string`);
            try {
                startRe = new RegExp(o.startPattern);
            }
            catch (e) {
                throw new Error(`logTail [${desc}]: multiline.startPattern is not a valid regex: ${e.message}`);
            }
        }
        if (!startRe && o.indent === false) {
            throw new Error(`logTail [${desc}]: multiline needs either startPattern or indent mode`);
        }
        const joiner = o.joiner ?? '\n';
        if (typeof joiner !== 'string')
            throw new Error(`logTail [${desc}]: multiline.joiner must be a string`);
        const maxLines = o.maxLines ?? TAIL_MULTILINE_MAX_LINES;
        if (!Number.isInteger(maxLines) || maxLines < 2) {
            throw new Error(`logTail [${desc}]: multiline.maxLines must be an integer >= 2`);
        }
        const flushMs = o.flushMs ?? TAIL_MULTILINE_FLUSH_MS;
        if (!Number.isFinite(flushMs) || flushMs < 0) {
            throw new Error(`logTail [${desc}]: multiline.flushMs must be a number >= 0`);
        }
        return { startRe, joiner, maxLines, flushMs };
    }
    format(data, fh) {
        void fh;
        return toFields(data, this.tok);
    }
    start() {
        log.info(`started: ${this.params.plugin} [${this.params.description}] tailing ${this.path}`);
        this.scheduleNext(0);
    }
    stop() {
        this.stopped = true;
        if (this.timer)
            clearTimeout(this.timer);
        this.flushEntry();
    }
    scheduleNext(delay) {
        if (this.stopped)
            return;
        this.timer = setTimeout(() => void this.tick(), delay);
    }
    async tick() {
        if (this.stopped || this.polling) {
            this.scheduleNext(this.pollMs);
            return;
        }
        this.polling = true;
        try {
            await this.poll();
        }
        catch (err) {
            this.noteDrop('read-error');
            log.debug(`${this.params.plugin} [${this.params.description}]: tail error on ${this.path}: ` +
                `${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.polling = false;
            this.scheduleNext(this.pollMs);
        }
    }
    async poll() {
        if (this.ml && this.entryLines.length && Date.now() - this.entryAt >= this.ml.flushMs) {
            this.flushEntry();
        }
        const meta = await this.statFile();
        if (!meta || !meta.isFile)
            return;
        const id = fileIdentity(meta);
        if (this.identity === undefined) {
            this.identity = id;
            this.pos = this.fromStart ? 0 : meta.size;
            this.atStart = this.fromStart;
        }
        else if (id !== this.identity) {
            this.rollover();
            this.identity = id;
            this.pos = 0;
            this.atStart = true;
        }
        else if (meta.size < this.pos) {
            this.rollover();
            this.pos = 0;
            this.atStart = true;
        }
        if (meta.size <= this.pos)
            return;
        await this.readDelta(meta.size);
    }
    async statFile() {
        try {
            const st = await stat(this.path);
            return { isFile: st.isFile(), size: st.size, ino: Number(st.ino), birthMs: st.birthtimeMs };
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return null;
            throw err;
        }
    }
    async readDelta(size) {
        const fh = await open(this.path, 'r');
        try {
            const buf = Buffer.allocUnsafe(TAIL_CHUNK_BYTES);
            while (this.pos < size && !this.stopped) {
                const want = Math.min(TAIL_CHUNK_BYTES, size - this.pos);
                const { bytesRead } = await fh.read(buf, 0, want, this.pos);
                if (bytesRead <= 0)
                    break;
                this.ingest(buf.subarray(0, bytesRead));
                this.pos += bytesRead;
            }
        }
        finally {
            await fh.close();
        }
    }
    ingest(chunk) {
        this.lineBuf += this.decoder.write(chunk);
        if (this.atStart && this.lineBuf.length) {
            if (this.lineBuf.charCodeAt(0) === 0xfeff)
                this.lineBuf = this.lineBuf.slice(1);
            this.atStart = false;
        }
        let nl;
        while ((nl = this.lineBuf.indexOf('\n')) !== -1) {
            this.emitLine(this.lineBuf.slice(0, nl));
            this.lineBuf = this.lineBuf.slice(nl + 1);
        }
        if (this.lineBuf.length > this.maxLineBytes) {
            this.noteDrop('oversize-line');
            this.emitLine(this.lineBuf);
            this.lineBuf = '';
        }
    }
    emitLine(raw) {
        const line = raw.replace(/\r$/, '');
        if (!line.length)
            return;
        if (!this.ml) {
            this.send(line);
            return;
        }
        const startsEntry = this.ml.startRe ? this.ml.startRe.test(line) : !/^[ \t]/.test(line);
        if (startsEntry && this.entryLines.length)
            this.flushEntry();
        this.entryLines.push(line);
        this.entryAt = Date.now();
        if (this.entryLines.length >= this.ml.maxLines) {
            this.noteDrop('multiline-cap');
            this.flushEntry();
        }
    }
    flushEntry() {
        if (!this.ml || !this.entryLines.length)
            return;
        const entry = this.entryLines.join(this.ml.joiner);
        this.entryLines = [];
        this.send(entry);
    }
    rollover() {
        const tail = this.lineBuf + this.decoder.end();
        if (tail.length)
            this.emitLine(tail);
        this.flushEntry();
        this.lineBuf = '';
        this.decoder = new StringDecoder('utf8');
    }
}
