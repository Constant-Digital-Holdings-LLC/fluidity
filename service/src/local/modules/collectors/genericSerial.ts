import { fetchLogger } from '#@shared/modules/application.js';
import { SerialCollector, SerialCollectorParams, SerialCollectorPlugin } from '#@service/modules/collectors.js';
import { ReadlineParser } from 'serialport';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = fetchLogger(conf);

export default class GenericSerialCollector extends SerialCollector implements SerialCollectorPlugin {
    constructor(params: SerialCollectorParams) {
        super(params);
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
