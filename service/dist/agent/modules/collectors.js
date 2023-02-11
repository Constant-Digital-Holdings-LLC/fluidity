import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort } from 'serialport';
import { isFfluidityPacket } from '#@shared/types.js';
import { setIntervalAsync } from 'set-interval-async';
import throttledQueue from 'throttled-queue';
const conf = await confFromFS();
const log = fetchLogger(conf);
import https from 'https';
const NODE_ENV = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
export const isDataCollectorParams = (obj) => {
    const { targets, omitTS, keepRaw, extendedOptions } = obj;
    return (isFfluidityPacket(obj, true) &&
        Array.isArray(targets) &&
        Boolean(targets.length) &&
        (typeof omitTS === 'undefined' || typeof omitTS === 'boolean') &&
        (typeof keepRaw === 'undefined' || typeof keepRaw === 'boolean') &&
        (typeof extendedOptions === 'undefined' || extendedOptions instanceof Object));
};
export class FormatHelper {
    formattedData = [];
    e(element, suggestStyle) {
        suggestStyle ??= 0;
        if (typeof element === 'string') {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'STRING' });
        }
        else if (element instanceof Object && 'location' in element && 'name' in element) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'LINK' });
        }
        else if (element instanceof Date) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'DATE' });
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
    return ('errno' in e &&
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
    constructor(params) {
        this.params = params;
        if (!isDataCollectorParams(params))
            throw new Error(`DataCollector class constructor - invalid runtime params`);
        const { maxHttpsReqPerCollectorPerSec = 2 } = params;
        log.info(`Agent: maxHttpsReqPerCollectorPerSec: ${maxHttpsReqPerCollectorPerSec}`);
        this.throttle = throttledQueue(maxHttpsReqPerCollectorPerSec, 1000);
    }
    addTS(data) {
        return data;
    }
    _reqJSON(method, uo, data, key) {
        const { protocol, hostname, port, pathname } = uo;
        return new Promise((resolve, reject) => {
            if (method === 'POST' && !key) {
                reject('DataCollector: POST method requires API Key');
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
                    if (res.statusCode && res.statusCode / 2 === 100) {
                        resolve(data);
                    }
                    else {
                        req.end();
                        reject(`makeReq() non 200 series response`);
                    }
                });
                res.on('error', () => {
                    req.end();
                    reject(`makeReq() request error`);
                });
            });
            req.on('error', e => {
                if (isHttpError(e)) {
                    if (e.code === 'ECONNREFUSED') {
                        req.end();
                        reject(`Connection REFUSED connecting to host ${e.address} on port ${e.port}`);
                    }
                }
                else if (isSysError(e)) {
                    if (e.code === 'ECONNRESET') {
                        req.end();
                        reject(`Connection RESET during ${e.syscall}`);
                    }
                }
                else {
                    req.end();
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
        for await (const { location, key } of targets) {
            try {
                await this.post(location, fPacket, key);
            }
            catch (err) {
                log.error(err);
            }
        }
    }
    send(data) {
        const { targets, keepRaw, extendedOptions, omitTS, ...rest } = this.params;
        for (const [key, value] of Object.entries(process.memoryUsage())) {
            log.debug(`Memory usage by ${key}, ${value / 1000000}MB `);
        }
        let formattedData = this.format(data, new FormatHelper());
        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            this.sendHttps(targets, { formattedData, rawData: keepRaw ? data : null, ...rest });
        }
        else {
            log.warn(`DataCollector: ignoring unkown string: ${data}`);
        }
    }
}
export class WebJSONCollector extends DataCollector {
    url;
    pollIntervalSec;
    constructor({ url, pollIntervalSec, ...params }) {
        super(params);
        if (typeof url !== 'string') {
            throw new Error(`missing url (string) in config for ${params.plugin}: ${params.description}`);
        }
        if (typeof pollIntervalSec !== 'number') {
            throw new Error(`missing pollIntervalSec (number) in config for ${params.plugin}: ${params.description}`);
        }
        this.url = new URL(url);
        this.pollIntervalSec = pollIntervalSec;
    }
    start() {
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
        setIntervalAsync(async () => {
            log.info(`${this.params.plugin} [${this.params.description}]: contacting host...(${this.url.host})`);
            try {
                this.send(await this.get(this.url.href));
            }
            catch (err) {
                log.error(err);
            }
        }, this.pollIntervalSec * 1000);
    }
}
export class SerialCollector extends DataCollector {
    port;
    parser;
    format(data, fh) {
        return fh.e(data).done;
    }
    constructor({ path, baudRate, ...params }) {
        super(params);
        if (typeof path !== 'string')
            throw new Error(`expected serial port identifier (string) in config for ${params.plugin}: ${params.description}`);
        if (typeof baudRate !== 'number')
            throw new Error(`expected numeric port speed in config for ${params.plugin}: ${params.description}`);
        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }
    start() {
        this.parser.on('data', this.send.bind(this));
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
    }
}
