import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort } from 'serialport';
import { isFfluidityPacket } from '#@shared/types.js';
import got from 'got';
import { setIntervalAsync } from 'set-interval-async';
import throttledQueue from 'throttled-queue';
const conf = await confFromFS();
const log = fetchLogger(conf);
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
export class DataCollector {
    params;
    throttle;
    constructor(params) {
        this.params = params;
        if (!isDataCollectorParams(params))
            throw new Error(`DataCollector class constructor - invalid runtime params`);
        this.throttle = throttledQueue(500, 1000);
    }
    addTS(data) {
        return data;
    }
    async sendHttps(targets, fPacket) {
        log.debug(`to: ${JSON.stringify(targets)}`);
        log.debug(fPacket);
        await Promise.all(targets.map(async ({ location, key }) => {
            try {
                return await this.throttle(await got.post(location, {
                    https: {
                        rejectUnauthorized: NODE_ENV === 'development' ? false : true
                    },
                    headers: {
                        'User-Agent': conf?.appName && conf.appVersion
                            ? `${conf.appName} ${conf.appVersion}`
                            : 'Fluidity',
                        'X-API-Key': key
                    },
                    json: fPacket
                }));
            }
            catch (err) {
                if (err instanceof Error) {
                    const res = err.message.match(/.*\s+([A-Z]+)\s+(.*)/);
                    if (res && res[1] === 'ECONNREFUSED') {
                        log.error(`sendHttps() POST: Connection refused connecting to ${res[2]}`);
                    }
                    else {
                        log.error(`sendHttps() POST: ${err.message}`);
                    }
                }
                else {
                    log.error(`sendHttps() POST: ${err}`);
                }
            }
        }));
    }
    send(data) {
        const { targets, keepRaw, extendedOptions, omitTS, ...rest } = this.params;
        log.debug('in send():');
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
                this.send(await got(this.url.href).text());
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
