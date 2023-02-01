import { SerialCollector } from '#@service/modules/collectors.js';
import { ReadlineParser } from 'serialport';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = LoggerUtil.new(conf);
export default class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
