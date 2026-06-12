import { SerialCollector, extOpt } from '../collectors.js';
import { parseTokenizeConfig, toFields } from '../tokenize.js';
import { ReadlineParser } from 'serialport';
export default class GenericSerialCollector extends SerialCollector {
    tok;
    constructor(params) {
        super(params);
        this.tok = parseTokenizeConfig(extOpt(params.extendedOptions, 'tokenize'), false, `genericSerial [${params.description}]`);
    }
    format(data, fh) {
        void fh;
        const line = data.replace(/\r$/, '');
        return line ? toFields(line, this.tok) : null;
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
