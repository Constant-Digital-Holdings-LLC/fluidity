import { fetchLogger, confFromFS } from '#@shared/modules/appResources.js';
import { SerialCollector, SerialCollectorParams, SerialCollectorPlugin } from '#@service/modules/collectors.js';
import { ReadlineParser } from 'serialport';

const { conf } = await confFromFS();

const log = fetchLogger(conf);

export default class GenericSerialCollector extends SerialCollector implements SerialCollectorPlugin {
    constructor(params: SerialCollectorParams) {
        super(params);
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
