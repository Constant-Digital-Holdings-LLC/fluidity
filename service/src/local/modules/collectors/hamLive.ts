import { fetchLogger } from '#@shared/modules/application.js';
import { FormattedData } from '#@shared/types.js';
import { FormatHelper, DataCollectorPlugin } from '#@service/modules/collectors.js';
import { WebJSONCollector, WebJSONCollectorParams } from '#@service/modules/collectors.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = fetchLogger(conf);

export default class HamLiveCollector extends WebJSONCollector implements DataCollectorPlugin {
    //url can be overridden by config:
    constructor({ url = 'https://www.ham.live/api/data/livenets', ...params }: WebJSONCollectorParams) {
        super({ url, ...params });
    }

    format(data: string, fh: FormatHelper): FormattedData[] | null {
        const netData = JSON.parse(data);

        netData.netlist.forEach((net: any) => {
            fh.e(net.title);
        });

        return fh.done;
    }
}
