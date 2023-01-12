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
var RadioStates;
(function (RadioStates) {
    RadioStates[RadioStates["COR"] = 0] = "COR";
    RadioStates[RadioStates["PL"] = 1] = "PL";
    RadioStates[RadioStates["RCVACT"] = 2] = "RCVACT";
    RadioStates[RadioStates["DTMF"] = 3] = "DTMF";
    RadioStates[RadioStates["XMIT ON"] = 4] = "XMIT ON";
})(RadioStates || (RadioStates = {}));
var PortStates;
(function (PortStates) {
    PortStates[PortStates["LINK"] = 0] = "LINK";
    PortStates[PortStates["LOOPBACK"] = 1] = "LOOPBACK";
    PortStates[PortStates["DISABLED"] = 2] = "DISABLED";
    PortStates[PortStates["SUDISABLED"] = 3] = "SUDISABLED";
    PortStates[PortStates["SPLIT GROUP"] = 4] = "SPLIT GROUP";
    PortStates[PortStates["INTERFACED"] = 5] = "INTERFACED";
})(PortStates || (PortStates = {}));
export class SRSserialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    decode(stateType, radix, decodeList) {
        const portMatrix = [[]];
        log.debug(stateType);
        portMatrix[0]?.push('PL');
        return [['INTERFACED', 'LINK']];
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
            let stateData;
            if (data[0] === '[') {
                stateData = this.decode(RadioStates, 16, result[1].split(' '));
            }
            if (data[0] === '{') {
                stateData = this.decode(PortStates, 16, result[1].split(' '));
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
