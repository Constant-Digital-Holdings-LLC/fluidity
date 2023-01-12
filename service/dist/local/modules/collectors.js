import { SerialPort, ReadlineParser } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
const isSRSportMap = (obj) => {
    return Array.isArray(obj) && typeof obj[0] === 'string';
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
        const portMatrix = [[], [], [], [], [], [], [], []];
        decodeList.forEach((dc, decodeIndex) => {
            const binText = [];
            let num = parseInt(dc, radix);
            const prefix = radix === 16 ? '0x' : '';
            if (num) {
                log.info('\n\n');
                log.info(`Decoding:\t${prefix + dc.toUpperCase()} (${stateType === 'PORT' ? portStates[decodeIndex] : radioStates[decodeIndex]}) of ${decodeList.map(v => prefix + v.toUpperCase())}\t`);
                for (let bit = 0; bit < 8 && num; bit++) {
                    if ((num & 1) === 1) {
                        binText.unshift('1');
                        if (stateType === 'RADIO') {
                            portMatrix[bit]?.push(radioStates[decodeIndex]);
                        }
                        if (stateType === 'PORT') {
                            portMatrix[bit]?.push(portStates[decodeIndex]);
                        }
                    }
                    else {
                        binText.unshift('0');
                    }
                    num >>= 1;
                }
                log.info(`Decoded:\t${JSON.stringify(binText)}\t`);
            }
        });
        return portMatrix;
    }
    format(data) {
        const result = data.match(/[[{]((?:[a-fA-F0-9]{2}\s*)+)[\]}]/);
        let stateData = [[]];
        const pLookup = (p) => {
            let portName;
            const eo = this.params.extendedOptions;
            if (eo && typeof eo === 'object' && 'portmap' in eo) {
                const { portmap } = eo;
                if (isSRSportMap(portmap)) {
                    portName = portmap[p];
                }
            }
            return portName ? `port-${p} [${portName}]` : `port-${p}`;
        };
        if (typeof result?.[1] === 'string' && (data[0] === '[' || data[0] === '{')) {
            if (data[0] === '[') {
                stateData = this.decode('RADIO', 16, result[1].split(' '));
            }
            if (data[0] === '{') {
                stateData = this.decode('PORT', 16, result[1].split(' '));
            }
        }
        else {
            return null;
        }
        stateData.forEach((s, index) => {
            if (s.length)
                log.info(`${pLookup(index)}:\t${s}\t`);
        });
        return [{ display: 1, field: data }];
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
