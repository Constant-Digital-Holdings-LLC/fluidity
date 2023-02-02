import { fetchLogger } from '#@shared/modules/application.js';
import { WebJSONCollector } from '#@service/modules/collectors.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
export default class HamLiveCollector extends WebJSONCollector {
    constructor({ url = 'https://www.ham.live/api/data/livenets', ...params }) {
        super({ url, ...params });
    }
    format(data, fh) {
        const netData = JSON.parse(data);
        netData.netlist.forEach((net) => {
            fh.e(net.title);
        });
        return fh.done;
    }
}
