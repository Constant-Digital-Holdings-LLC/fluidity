import { SerialPort, ReadlineParser } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
const isSRSportMap = (obj) => {
    return Array.isArray(obj) && typeof obj[0] === 'string';
};
class FormatUtility {
    formattedData = [];
    s(display = 0, element) { }
    d(display = 0, element) { }
    l(element) { }
    s0(element) {
        return this.s(0, element);
    }
    s1(element) {
        return this.s(1, element);
    }
    s2(element) {
        return this.s(2, element);
    }
    s3(element) {
        return this.s(3, element);
    }
    s4(element) {
        return this.s(4, element);
    }
    s5(element) {
        return this.s(5, element);
    }
    s6(element) {
        return this.s(6, element);
    }
    s7(element) {
        return this.s(7, element);
    }
    s8(element) {
        return this.s(8, element);
    }
    s9(element) {
        return this.s(9, element);
    }
    d0(element) {
        return this.d(0, element);
    }
    d1(element) {
        return this.d(1, element);
    }
    d2(element) {
        return this.d(2, element);
    }
    d3(element) {
        return this.d(3, element);
    }
    d4(element) {
        return this.d(4, element);
    }
    d5(element) {
        return this.d(5, element);
    }
    d6(element) {
        return this.d(6, element);
    }
    d7(element) {
        return this.d(7, element);
    }
    d8(element) {
        return this.d(8, element);
    }
    d9(element) {
        return this.d(9, element);
    }
    get done() {
        return this.formattedData;
    }
}
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
        return [{ display: 1, field: data, fieldType: 'string' }];
    }
    addTS(data) {
        return data;
    }
    sendHttps(fPacket) {
    }
    send(data) {
        const { site, label, collectorType, targets, keepRaw } = this.params;
        let formattedData = this.format(data);
        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        if (formattedData) {
                            this.sendHttps({
                                site,
                                label,
                                collectorType,
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
                        if (stateType === 'RADIO' && radioStates[decodeIndex]) {
                            portMatrix[bit].push(radioStates[decodeIndex]);
                        }
                        if (stateType === 'PORT' && portStates[decodeIndex]) {
                            portMatrix[bit].push(portStates[decodeIndex]);
                        }
                    }
                    else {
                        binText.unshift('0');
                    }
                    num >>= 1;
                }
                log.info(`Decoded:\t${binText.toString()}\t\t`);
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
        return [{ display: 1, field: data, fieldType: 'string' }];
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
