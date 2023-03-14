import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData, isObject } from '#@shared/types.js';
import { FormatHelper, DataCollectorPlugin, WebJSONCollector, WebJSONCollectorParams } from '../collectors.js';

const conf = await confFromFS();
const halfHour = 1800000;

const log = fetchLogger(conf);
const lastNotified = new Map<string, number>();
let lastHash = '';

interface NetDetail {
    id: string;
    title: string;
    frequency: string;
    mode: string;
    permanent: boolean;
    modeDetails: string;
    countdownTimer: number;
    started: boolean;
    url: string;
    createdAt: string;
}

const isNetDetail = (item: unknown): item is NetDetail => {
    if (!isObject(item)) {
        return false;
    }

    const stringAndTrue = (s: unknown) => typeof s === 'string' && Boolean(s);

    const { id, title, frequency, mode, permanent, modeDetails, countdownTimer, started, url, createdAt } =
        item as Partial<NetDetail>;

    return (
        stringAndTrue(id) &&
        stringAndTrue(title) &&
        typeof frequency === 'string' &&
        stringAndTrue(mode) &&
        typeof permanent === 'boolean' &&
        typeof modeDetails === 'string' &&
        typeof countdownTimer === 'number' &&
        typeof started === 'boolean' &&
        stringAndTrue(url) &&
        stringAndTrue(createdAt)
    );
};

export default class HamLiveCollector extends WebJSONCollector implements DataCollectorPlugin {
    //default url can be overridden by config:
    constructor({ url = 'https://www.ham.live/api/data/livenets', ...params }: WebJSONCollectorParams) {
        super({ url, ...params });
    }

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        const netData: unknown = JSON.parse(data);

        if (isObject(netData) && 'hash' in netData && typeof netData.hash === 'string') {
            if (netData.hash !== lastHash) {
                if ('netlist' in netData && Array.isArray(netData.netlist)) {
                    netData.netlist.forEach((net, idx, arr) => {
                        if (isNetDetail(net) && !net.permanent) {
                            const ts = lastNotified.get(net.id);

                            if (typeof ts === 'undefined' || Date.now() - ts >= halfHour) {
                                log.debug(`hamLive: OK to notify re: ${net.title}`);
                                fh.e({ location: `https://ham.live${net.url}`, name: net.title }, 6).e(
                                    ` ${net.started ? ' in progress' : ' starts at '}`
                                );
                                if (!net.started) {
                                    const startTime = new Date(net.createdAt);
                                    startTime.setMinutes(startTime.getMinutes() + net.countdownTimer);
                                    fh.e(startTime, 3);
                                }
                                idx <= arr.length - 2 && fh.e(', ', 100);

                                lastNotified.set(net.id, Date.now());
                            } else {
                                log.debug('hamLive: already notified re this net');
                            }
                        }
                    });
                }
            } else {
                log.debug('hamLive: hash unchanged');
            }
            lastHash = netData.hash;
        }

        return fh.done;
    }
}
