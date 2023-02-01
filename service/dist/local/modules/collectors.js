import { SerialPort } from 'serialport';
import { isFfluidityPacket } from '#@shared/types.js';
import { setIntervalAsync } from 'set-interval-async';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
import axios from 'axios';
const conf = await config();
const log = LoggerUtil.new(conf);
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
    constructor(params) {
        this.params = params;
        if (!isDataCollectorParams(params))
            throw new Error(`DataCollector class constructor - invalid runtime params`);
    }
    format(data, fh) {
        return fh.e(data).done;
    }
    addTS(data) {
        return data;
    }
    sendHttps(target, fPacket) {
        log.info(`${fPacket.plugin} [${fPacket.description}]:\t\tPOST ${target.location}`);
        log.debug('############### BEGIN ONE HTTP POST ###############');
        log.debug(fPacket);
        log.debug('############### END ONE HTTP POST   ###############');
    }
    send(data) {
        const { site, description, plugin, targets, keepRaw } = this.params;
        let formattedData = this.format(data, new FormatHelper());
        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        if (formattedData) {
                            this.sendHttps(t, {
                                site,
                                description,
                                plugin,
                                formattedData: formattedData,
                                rawData: keepRaw ? data : null
                            });
                        }
                    }
                    else {
                        throw new Error(`unsupported protocol in target location: ${t.location}`);
                    }
                });
            }
            catch (err) {
                log.error(err);
            }
        }
        else {
            log.debug(`DataCollector: ignoring unkown string: ${data}`);
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
            log.info(`${this.params.plugin} [${this.params.description}]: contacting host ${this.url.host}`);
            const myAxios = axios.create({
                transformResponse: [
                    function transformResponse(data) {
                        return data;
                    }
                ]
            });
            try {
                this.send((await myAxios.get(this.url.href)).data);
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
