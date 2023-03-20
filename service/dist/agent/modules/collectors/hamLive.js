import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { isObject } from '#@shared/types.js';
import { WebJSONCollector } from '../collectors.js';
const conf = await confFromFS();
const log = fetchLogger(conf);
const lastNotified = new Map();
const isNetDetail = (item) => {
    if (!isObject(item)) {
        return false;
    }
    const stringAndTrue = (s) => typeof s === 'string' && Boolean(s);
    const { id, title, frequency, mode, permanent, modeDetails, countdownTimer, started, url, createdAt } = item;
    return (stringAndTrue(id) &&
        stringAndTrue(title) &&
        typeof frequency === 'string' &&
        stringAndTrue(mode) &&
        typeof permanent === 'boolean' &&
        typeof modeDetails === 'string' &&
        typeof countdownTimer === 'number' &&
        typeof started === 'boolean' &&
        stringAndTrue(url) &&
        stringAndTrue(createdAt));
};
export default class HamLiveCollector extends WebJSONCollector {
    notifyIntervalSec;
    constructor({ url = 'https://www.ham.live/api/data/livenets', notifyIntervalSec = 1800, ...params }) {
        super({ url, ...params });
        this.notifyIntervalSec = notifyIntervalSec;
    }
    format(data, fh) {
        const netData = JSON.parse(data);
        if (isObject(netData) && 'netlist' in netData && Array.isArray(netData.netlist)) {
            netData.netlist.forEach((net, idx, arr) => {
                if (isNetDetail(net) && !net.permanent) {
                    const ts = lastNotified.get(net.id);
                    if (typeof ts === 'undefined' || Date.now() - ts >= this.notifyIntervalSec * 1000) {
                        log.debug(`hamLive: OK to notify re: ${net.title}`);
                        fh.e({ location: `https://ham.live${net.url}`, name: net.title }, 6).e(` ${net.started ? ' in progress' : ' starts at '}`);
                        if (!net.started) {
                            const startTime = new Date(net.createdAt);
                            startTime.setMinutes(startTime.getMinutes() + net.countdownTimer);
                            fh.e(startTime, 3);
                        }
                        idx <= arr.length - 2 && fh.e(', ', 100);
                        lastNotified.set(net.id, Date.now());
                    }
                    else {
                        log.debug('hamLive: already notified re this net');
                    }
                }
            });
        }
        return fh.done;
    }
}
