import { fetchLogger } from '#@shared/modules/utils.js';
import { SerialCollector } from '#@service/modules/collectors.js';
import { ReadlineParser } from 'serialport';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
export default class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
