import { SerialPort } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
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
        const { targets, site, description, name, keepRaw, omitTS } = params || {};
        if (!Array.isArray(targets)) {
            throw new Error(`DataCollector constructor - expected array of targets[] in config`);
        }
        if (typeof site !== 'string') {
            throw new Error(`DataCollector constructor - site name in config`);
        }
        if (typeof description !== 'string') {
            throw new Error(`DataCollector constructor - collector ${name} missing description in config`);
        }
        if (typeof name !== 'string') {
            throw new Error(`DataCollector constructor - collector ${description} requires a name field in config`);
        }
        if (typeof keepRaw !== 'undefined' && typeof keepRaw !== 'boolean') {
            throw new Error(`DataCollector constructor - optional keepRaw field should be a boolean for collector: ${name}`);
        }
        if (typeof omitTS !== 'undefined' && typeof omitTS !== 'boolean') {
            throw new Error(`DataCollector constructor - optional omitTS field should be a boolean for collector ${name}`);
        }
    }
    stop() {
        log.info(`stopped: ${this.params.name}`);
    }
    format(data, fh) {
        return fh.e(data).done;
    }
    addTS(data) {
        return data;
    }
    sendHttps(fPacket) {
        log.debug('############### BEGIN ONE HTTP POST ###############');
        log.debug(fPacket);
        log.debug('############### END ONE HTTP POST   ###############');
    }
    send(data) {
        const { site, description, name, targets, keepRaw } = this.params;
        let formattedData = this.format(data, new FormatHelper());
        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        log.debug(`location: ${t.location}, `);
                        if (formattedData) {
                            this.sendHttps({
                                site,
                                description,
                                name,
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
            throw new Error(`expected serial port identifier (string) in config for ${params.name}: ${params.description}`);
        if (typeof baudRate !== 'number')
            throw new Error(`expected numeric port speed in config for ${params.name}: ${params.description}`);
        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }
    start() {
        this.parser.on('data', this.send.bind(this));
        log.info(`${this.params.name} started`);
    }
}
