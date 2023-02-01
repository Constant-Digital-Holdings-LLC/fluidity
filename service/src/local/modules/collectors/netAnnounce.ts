import { FormattedData } from '#@shared/types.js';
import { DataCollector, DataCollectorPlugin, DataCollectorParams, FormatHelper } from '#@service/modules/collectors.js';
import { LoggerUtil } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = LoggerUtil.new(conf);

export default class NetAnnounce extends DataCollector implements DataCollectorPlugin {
    private pollIntervalMin: number;
    private announceEveryMin: number;

    constructor(params: { pollIntervalMin: number; announceEveryMin: number } & DataCollectorParams) {
        super(params);

        if (typeof params.pollIntervalMin === 'number' && typeof params.announceEveryMin === 'number') {
            ({ pollIntervalMin: this.pollIntervalMin, announceEveryMin: this.announceEveryMin } = params);
        } else {
            throw new Error(
                `expected numeric values pollIntervalMin/announceEveryMin for ${params.plugin}: ${params.description}`
            );
        }
    }

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    start(): void {
        //use setIntervalAsync (imported) here. Have it call this.send()
        log.info(`${this.params.plugin} started`);
    }
}
