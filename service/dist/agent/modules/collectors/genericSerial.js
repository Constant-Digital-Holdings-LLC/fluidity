import { SerialCollector } from '../collectors.js';
import { ReadlineParser } from 'serialport';
export default class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
