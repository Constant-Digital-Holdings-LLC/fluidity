import { fetchLogger, confFromFS } from '#@shared/modules/appResources.js';
import { SerialCollector } from '#@service/modules/collectors.js';
import { ReadlineParser } from 'serialport';
const { conf } = await confFromFS();
const log = fetchLogger(conf);
export default class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
