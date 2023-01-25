import { SerialPort, ReadlineParser } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
const isSRSportMap = (obj) => {
    return Array.isArray(obj) && typeof obj[0] === 'string';
};
class FormatHelper {
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
    format(data, fh) {
        return fh.e(data).done;
    }
    addTS(data) {
        return data;
    }
    sendHttps(fPacket) {
        log.debug(fPacket);
    }
    send(data) {
        const { site, label, collectorType, targets, keepRaw } = this.params;
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
    decode(stateList, radix, decodeList) {
        const portMatrix = [[], [], [], [], [], [], [], []];
        decodeList.forEach((dc, decodeIndex) => {
            const binText = [];
            let num = parseInt(dc, radix);
            const prefix = radix === 16 ? '0x' : '';
            if (num) {
                log.debug('\n\n');
                log.debug(`Decoding:\t${prefix + dc.toUpperCase()} (${stateList[decodeIndex]}) of ${decodeList.map(v => prefix + v.toUpperCase())}\t`);
                for (let bit = 0; bit < 8 && num; bit++) {
                    if ((num & 1) === 1) {
                        binText.unshift('1');
                        if (typeof stateList[decodeIndex] === 'string') {
                            portMatrix[bit]?.push(stateList[decodeIndex]);
                        }
                    }
                    else {
                        binText.unshift('0');
                    }
                    num >>= 1;
                }
                log.debug(`Decoded:\t${binText.toString()}\t\t`);
            }
        });
        return portMatrix;
    }
    format(data, fh) {
        const result = data.match(/[[{]((?:[a-fA-F0-9]{2}\s*)+)[\]}]/);
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
                return [
                    ...fh
                        .e('RADIO States->', 0)
                        .done,
                    ...this.decode(radioStates, 16, result[1].split(' ')).flatMap((s, index) => s.length ? fh
                        .e(`${pLookup(index)}:`, 0)
                        .e(s, 21)
                        .done
                        : [])
                ];
            }
            if (data[0] === '{') {
                return [
                    ...fh
                        .e('PORT States->', 0)
                        .done,
                    ...this.decode(portStates, 16, result[1].split(' ')).flatMap((s, index) => s.length ? fh
                        .e(`${pLookup(index)}:`, 0)
                        .e(s, 22)
                        .done
                        : [])
                ];
            }
        }
        return null;
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
