import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData, isObject } from '#@shared/types.js';
import { FormatHelper, DataCollectorPlugin, WebJSONCollector, WebJSONCollectorParams } from '../collectors.js';

const conf = await confFromFS();

const log = fetchLogger(conf);

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
    private notifyIntervalSec: number;
    //per-instance, like all collector state: two stanzas polling different
    //deployments must not cross-suppress each other's net ids
    private readonly lastNotified = new Map<string, number>();
    //default url can be overridden by config:
    constructor({
        url = 'https://www.ham.live/api/data/livenets',
        notifyIntervalSec = 900,
        ...params
    }: WebJSONCollectorParams) {
        super({ url, ...params });
        this.notifyIntervalSec = notifyIntervalSec;
    }

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        //a packet built now would be shed by the saturated upstream path -
        //skip the whole pass so nets aren't marked notified for an
        //announcement that never goes out. (A net whose POST later fails on
        //the wire is still marked - delivery isn't observable from here.)
        if (this.upstreamSaturated) return null;

        const netData: unknown = JSON.parse(data);

        if (!(isObject(netData) && 'netlist' in netData && Array.isArray(netData.netlist))) {
            return fh.done;
        }

        const now = Date.now();

        //expired entries are due for re-announcement and carry no further
        //information - dropping them keeps the map bounded by active nets
        for (const [id, ts] of this.lastNotified) {
            if (now - ts >= this.notifyIntervalSec * 1000) this.lastNotified.delete(id);
        }

        const eligible = netData.netlist.filter(
            (net): net is NetDetail => isNetDetail(net) && !net.permanent && !this.lastNotified.has(net.id)
        );

        eligible.forEach((net, idx) => {
            log.debug(`hamLive: OK to notify re: ${net.title}`);
            //resolve the net's path against the polled instance, so
            //self-hosted ham.live deployments link to themselves
            fh.e({ location: new URL(net.url, this.url).href, name: net.title }, 6).e(
                ` ${net.started ? ' in progress' : ' starts at '}`
            );
            if (!net.started) {
                const startTime = new Date(net.createdAt);
                startTime.setMinutes(startTime.getMinutes() + net.countdownTimer);
                fh.e(startTime, 3);
            }
            //separator judged against the emitted list, not the raw netlist -
            //a skipped net can no longer leave a dangling trailing comma
            if (idx < eligible.length - 1) fh.e(', ', 100);

            this.lastNotified.set(net.id, now);
        });

        return fh.done;
    }
}
