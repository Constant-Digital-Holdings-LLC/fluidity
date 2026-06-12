import { SerialCollector } from '../collectors.js';
import { ReadlineParser } from 'serialport';
export default class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    format(data, fh) {
        const line = data.replace(/\r$/, '');
        return line ? fh.e(line).done : null;
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
