import { WebJSONCollector } from '#@service/modules/collectors.js';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = LoggerUtil.new(conf);
export default class HamLiveCollector extends WebJSONCollector {
    constructor({ url, ...params }) {
        super({ url: 'https://www.ham.live/api/data/livenets', ...params });
    }
    format(data, fh) {
        const netData = JSON.parse(data);
        netData.netlist.forEach((net) => {
            fh.e(net.title);
        });
        return fh.done;
    }
}
