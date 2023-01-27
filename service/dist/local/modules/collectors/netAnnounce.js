import { DataCollector } from '#@service/modules/collectors.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
export default class NetAnnounce extends DataCollector {
    pollIntervalMin;
    announceEveryMin;
    constructor(params) {
        super(params);
        if (typeof params.pollIntervalMin === 'number' && typeof params.announceEveryMin === 'number') {
            ({ pollIntervalMin: this.pollIntervalMin, announceEveryMin: this.announceEveryMin } = params);
        }
        else {
            throw new Error(`expected numeric values pollIntervalMin/announceEveryMin for ${params.plugin}: ${params.description}`);
        }
    }
    format(data, fh) {
        return fh.e(data).done;
    }
    start() {
        log.info(`${this.params.plugin} started`);
    }
}
