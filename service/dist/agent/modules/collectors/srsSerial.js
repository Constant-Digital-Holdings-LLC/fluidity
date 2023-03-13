import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialCollector } from '../collectors.js';
import { ReadlineParser } from 'serialport';
const conf = await confFromFS();
const log = fetchLogger(conf);
const isSRSportMap = (obj) => {
    return Array.isArray(obj) && typeof obj[0] === 'string';
};
const radioStates = ['COR', 'PL', 'RCVACT', 'DTMF', 'XMIT_ON'];
const portStates = ['LINK', 'LOOPBACK', 'DISABLED', 'SUDISABLED', 'SPLIT_GROUP', 'INTERFACED'];
export default class SRSserialCollector extends SerialCollector {
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
                log.debug(`Decoding:\t${prefix + dc.toUpperCase()} (${stateList[decodeIndex] ?? 'unkown state'}) of ${decodeList.map(v => prefix + v.toUpperCase()).toString()}\t`);
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
            return portName ? `${portName}` : `port-${p}`;
        };
        if (typeof result?.[1] === 'string' && (data[0] === '[' || data[0] === '{')) {
            if (data[0] === '[') {
                const RS = this.decode(radioStates, 16, result[1].split(' ')).flatMap((s, index) => s.length ? fh.e(`${pLookup(index)}:`, 3).e(s, 9).done : []);
                if (RS.length) {
                    return [...fh.e('Radio States: ').done, ...RS];
                }
                else {
                    return null;
                }
            }
            if (data[0] === '{') {
                const PS = this.decode(portStates, 16, result[1].split(' ')).flatMap((s, index) => s.length ? fh.e(`${pLookup(index)}:`, 3).e(s, 7).done : []);
                if (PS.length) {
                    return [...fh.e('Port States: ').done, ...PS];
                }
                else {
                    return null;
                }
            }
        }
        return null;
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
