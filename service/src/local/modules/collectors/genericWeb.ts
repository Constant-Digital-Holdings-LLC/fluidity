import { WebJSONCollector, WebJSONCollectorParams } from '#@service/modules/collectors.js';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = LoggerUtil.new(conf);

export default class GenericWebCollector extends WebJSONCollector {
    constructor(params: WebJSONCollectorParams) {
        super(params);
    }
}
