import { SerialPort } from 'serialport';
import { isFfluidityPacket } from '#@shared/types.js';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
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
    stop() {
        log.info(`stopped: ${this.params.plugin}`);
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
        log.info(`${this.params.plugin} started`);
    }
}
