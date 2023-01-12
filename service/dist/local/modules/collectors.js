import { SerialPort, ReadlineParser } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
const isSRSOptions = (obj) => {
    return Array.isArray(obj?.portmap);
};
class DataCollector {
    params;
    constructor(params) {
        this.params = params;
        ['targets', 'site', 'label', 'collectorType', 'keepRaw'].forEach(p => {
            if (typeof params?.[p] === 'undefined') {
                throw new Error(`DataCollector constructor - required param: [${p}] undefined`);
            }
        });
    }
    format(data) {
        return [{ display: 1, field: data }];
    }
    addTS(delimData) {
        return delimData;
    }
    sendHttps(fPacket) {
    }
    send(data) {
        const { site, label, collectorType, targets, keepRaw } = this.params;
        let processedData = this.format(data);
        if (processedData) {
            !this.params.omitTS && (processedData = this.addTS(processedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        if (processedData) {
                            this.sendHttps({
                                site,
                                label,
                                collectorType,
                                processedData: processedData,
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
class SerialCollector extends DataCollector {
    port;
    parser;
    constructor({ path, baudRate, ...params }) {
        super(params);
        if (!path)
            throw new Error(`missing serial port identifier for ${params.collectorType}: ${params.label}`);
        if (!baudRate)
            throw new Error(`port speed for ${params.collectorType}: ${params.label}`);
        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }
    listen() {
        this.parser.on('data', this.send.bind(this));
    }
}
export class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
const radioStates = ['COR', 'PL', 'RCVACT', 'DTMF', 'XMIT_ON'];
const portStates = ['LINK', 'LOOPBACK', 'DISABLED', 'SUDISABLED', 'SPLIT_GROUP', 'INTERFACED'];
export class SRSserialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    decode(stateType, radix, decodeList) {
        let portMatrix = [[], [], [], [], [], [], [], [], []];
        decodeList.forEach((dc, decodeIndex) => {
            let num = parseInt(dc, radix);
            for (let bit = 0; bit < 8; bit++) {
                if ((num & 1) === 1) {
                    if (stateType === 'RADIO') {
                        portMatrix[bit]?.push(radioStates[decodeIndex]);
                    }
                    if (stateType === 'PORT') {
                        portMatrix[bit]?.push(portStates[decodeIndex]);
                    }
                }
                num >>= 1;
            }
        });
        return portMatrix;
    }
    portsInState(val) {
        const boolArr = [];
        for (let bit = 0; bit < 8; bit++) {
            boolArr.push((val & 1) === 1);
            val >>= 1;
        }
        return boolArr;
    }
    format(data) {
        const result = data.match(/[[{]((?:[a-fA-F0-9]{2}\s*)+)[\]}]/);
        if (typeof result?.[1] === 'string' && (data[0] === '[' || data[0] === '{')) {
            let stateData = [[]];
            if (data[0] === '[') {
                stateData = this.decode('RADIO', 16, result[1].split(' '));
                log.info(`Orig: ${data}`);
                log.debug('Radio States:');
                log.debug(`port 0 ${stateData[0]}`);
                log.debug(`port 1 ${stateData[1]}`);
                log.debug(`port 2 ${stateData[2]}`);
                log.debug(`port 3 ${stateData[3]}`);
                log.debug(`port 4 ${stateData[4]}`);
                log.debug(`port 5 ${stateData[5]}`);
                log.debug(`port 6 ${stateData[6]}`);
                log.debug(`port 7 ${stateData[7]}`);
            }
            if (data[0] === '{') {
                stateData = this.decode('PORT', 16, result[1].split(' '));
                log.info(`Orig: ${data}`);
                log.debug('Port States:');
                log.debug(`port 0 ${stateData[0]}`);
                log.debug(`port 1 ${stateData[1]}`);
                log.debug(`port 2 ${stateData[2]}`);
                log.debug(`port 3 ${stateData[3]}`);
                log.debug(`port 4 ${stateData[4]}`);
                log.debug(`port 5 ${stateData[5]}`);
                log.debug(`port 6 ${stateData[6]}`);
                log.debug(`port 7 ${stateData[7]}`);
            }
            if (isSRSOptions(this.params.extendedOptions)) {
                const { portmap } = this.params.extendedOptions;
            }
        }
        else {
            return null;
        }
        return [{ display: 99, field: data }];
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
