import { WebJSONCollector, WebJSONCollectorParams } from '#@service/modules/collectors.js';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = LoggerUtil.new(conf);

export default class HamLiveCollector extends WebJSONCollector {
    constructor({ url, ...params }: WebJSONCollectorParams) {
        super({ url: 'https://www.ham.live/api/data/livenets', ...params });
    }
}
