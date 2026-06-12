import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort, SerialPortMock } from 'serialport';
import { simProfileFromPath, startFeeder } from '#@sims/index.js';
import { isFfluidityPacket, isFluidityLink, isObject } from '#@shared/types.js';
import { throttledQueue } from 'throttled-queue';
const conf = await confFromFS();
const log = fetchLogger(conf);
import https from 'https';
const NODE_ENV = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
const MAX_PENDING_POSTS_ABS = 1024;
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
        const clone = JSON.parse(JSON.stringify(this.formattedData));
        this.formattedData.length = 0;
        return clone;
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
    constructor(params) {
        this.params = params;
        if (!isDataCollectorParams(params))
            throw new Error(`DataCollector class constructor - invalid runtime params`);
        const { maxHttpsReqPerCollectorPerSec = 2 } = params;
        log.info(`Agent: maxHttpsReqPerCollectorPerSec: ${maxHttpsReqPerCollectorPerSec}`);
        this.throttle = throttledQueue({ maxPerInterval: maxHttpsReqPerCollectorPerSec, interval: 1000 });
        this.maxPendingPosts = Math.min(MAX_PENDING_POSTS_ABS, Math.max(32, 2 * maxHttpsReqPerCollectorPerSec));
    }
    stop() { }
    _reqJSON(method, uo, data, key) {
        const { protocol, hostname, port, pathname } = uo;
        return new Promise((resolve, reject) => {
            if (method === 'POST') {
                if (!key) {
                    reject(new Error(`DataCollector: missing API key for ${uo.toString()}`));
                    return;
                }
                if (!/^[a-zA-Z0-9]+$/.test(key)) {
                    reject(new Error(`Invalid key format - API keys should be alphanumeric\nConsider using the bin/genApiKey utility`));
                    return;
                }
            }
            const req = https.request({
                protocol,
                rejectUnauthorized: NODE_ENV === 'development' ? false : true,
                hostname,
                port,
                method: method,
                path: pathname,
                headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Api-Key': key } : undefined
            }, (res) => {
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
            return await this._reqJSON('GET', new URL(location));
        });
    }
    async post(location, data, key) {
        return await this.throttle(async () => {
            return await this._reqJSON('POST', new URL(location), data, key);
        });
    }
    async sendHttps(targets, fPacket) {
        log.debug(`to: ${JSON.stringify(targets)}`);
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
        const { targets, keepRaw, ...rest } = this.params;
        void targets;
        for (const [key, value] of Object.entries(process.memoryUsage())) {
            log.debug(`Memory usage by ${key}, ${value / 1000000}MB `);
        }
        const formattedData = this.format(data, new FormatHelper());
        if (Array.isArray(formattedData) && formattedData.length) {
            void this.dispatch({
                ts: new Date().toISOString(),
                formattedData,
                rawData: keepRaw ? data : null,
                ...rest
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
    constructor({ pollIntervalSec, ...params }) {
        super(params);
        if (typeof pollIntervalSec !== 'number') {
            throw new Error(`polling collectors require pollIntervalSec in constructor ${params.plugin}: ${params.description}`);
        }
        this.pollIntervalSec = pollIntervalSec;
    }
    format(data, fh) {
        return fh.e(data).done;
    }
    start() {
        try {
            log.info(`started: ${this.params.plugin} [${this.params.description}]`);
            this.execPerInterval();
            this.timer = setTimeout(this.start.bind(this), this.pollIntervalSec * 1000);
        }
        catch (err) {
            log.error(err);
        }
    }
    stop() {
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
    }
    start() {
        this.parser.on('data', this.send.bind(this));
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
    }
    stop() {
        if (this.port.isOpen) {
            this.port.close();
        }
        else {
            this.port.once('open', () => this.port.close());
        }
    }
}
