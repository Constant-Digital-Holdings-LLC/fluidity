import { SerialCollector, SerialCollectorParams, SerialCollectorPlugin } from '#@service/modules/collectors.js';
import { ReadlineParser } from 'serialport';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = LoggerUtil.new(conf);

export default class GenericSerialCollector extends SerialCollector implements SerialCollectorPlugin {
    constructor(params: SerialCollectorParams) {
        super(params);
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
