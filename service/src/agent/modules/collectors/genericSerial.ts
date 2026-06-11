import { SerialCollector, SerialCollectorParams, SerialCollectorPlugin } from '../collectors.js';
import { ReadlineParser } from 'serialport';

export default class GenericSerialCollector extends SerialCollector implements SerialCollectorPlugin {
    constructor(params: SerialCollectorParams) {
        super(params);
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
