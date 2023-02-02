import { FormattedData } from '#@shared/types.js';
import { FormatHelper } from '#@service/modules/collectors.js';
import { WebJSONCollector, WebJSONCollectorParams } from '#@service/modules/collectors.js';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = LoggerUtil.new(conf);

export default class HamLiveCollector extends WebJSONCollector {
    constructor({ url = 'https://www.ham.live/api/data/livenets', ...params }: WebJSONCollectorParams) {
        super({ url, ...params });
    }

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        const netData = JSON.parse(data);

        netData.netlist.forEach((net: any) => {
            fh.e(net.title);
        });

        return fh.done;
    }
}
