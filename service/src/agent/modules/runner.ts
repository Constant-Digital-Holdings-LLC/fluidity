import { fetchLogger } from '#@shared/modules/logger.js';
import { MyConfigData } from '#@shared/modules/fluidityConfig.js';
import { isApiKeyFormat, HEARTBEAT_SEC } from '#@shared/types.js';
import { DataCollector, DataCollectorParams, isDataCollectorParams } from './collectors.js';

//validates agent config and instantiates the configured collector plugins;
//extracted from app.ts so misconfiguration behavior is testable
export const buildCollectors = async (conf: MyConfigData): Promise<DataCollector[]> => {
    const { targets, site } = conf;
    const log = fetchLogger(conf);

    if (typeof site !== 'string') {
        throw new Error(
            `in main config: a site name (string) must be defined for this agent (site: ${JSON.stringify(site)})`
        );
    }

    if (!targets) {
        throw new Error(`in main config: no targets defined to publish to (targets: ${JSON.stringify(targets)})`);
    }

    if (
        !targets.every(({ location, key }) => {
            return new URL(location).protocol === 'https:' && key;
        })
    ) {
        throw new Error(
            `in main config: targets must be HTTPS and an Api Key needs to be specified: ${JSON.stringify(
                targets.map(t => t.location)
            )}`
        );
    }

    //a malformed key fails here, once, at startup - not as an endless
    //per-packet rejection stream at runtime (same alphabet the server checks)
    if (!targets.every(({ key }) => isApiKeyFormat(key))) {
        throw new Error(
            'in main config: target API keys must be alphanumeric - consider using the bin/genApiKey utility'
        );
    }

    const collectorsConf = conf['collectors'];

    if (!(Array.isArray(collectorsConf) && collectorsConf.length)) {
        throw new Error('In plugin config processing: no data collectors defined in configuration');
    }

    //vRep is an internal liveness heartbeat, not a user collector: ignore any
    //configured vRep stanza and always run exactly one at the canonical cadence
    //(HEARTBEAT_SEC, overridable via conf.heartbeatSec). This guarantees every
    //site - even one with no data flowing - reports in within the dashboard's
    //fresh/recent/stale windows, which are derived from the same constant.
    const collectorList = collectorsConf as unknown[];
    const hbRaw = (conf as Record<string, unknown>)['heartbeatSec'];
    const heartbeatSec = typeof hbRaw === 'number' && hbRaw > 0 ? hbRaw : HEARTBEAT_SEC;
    const heartbeat = { description: 'Agent Report', plugin: 'vRep', pollIntervalSec: heartbeatSec };

    const userCollectors = collectorList.filter(c => (c as { plugin?: string }).plugin !== 'vRep');
    //a configured vRep is a leftover from before it went internal - it's ignored
    //(the heartbeat is fixed at heartbeatSec), so say so rather than silently drop it
    const configuredVRep = collectorList.length - userCollectors.length;
    if (configuredVRep > 0) {
        log.warn(
            `Agent: ${configuredVRep} configured "vRep" stanza(s) ignored - vRep is now an internal liveness ` +
                `heartbeat fixed at ${heartbeatSec}s. Remove it from collectors (set conf.heartbeatSec to tune the rate).`
        );
    }

    //only the bare boolean false disables a collector. A non-boolean `enabled`
    //(the string "false", 0, null, ...) does NOT disable it - so warn loudly
    //rather than silently leave a collector the operator meant to switch off
    //running. Same degrade-loudly doctrine as the udpStruct security options.
    for (const c of userCollectors) {
        const e = (c as { enabled?: unknown }).enabled;
        if (e !== undefined && typeof e !== 'boolean') {
            const name =
                (c as { description?: string }).description ?? (c as { plugin?: string }).plugin ?? '(unnamed)';
            log.warn(
                `Agent: collector "${name}" has a non-boolean "enabled" value (${JSON.stringify(e)}) - it will LOAD. ` +
                    `To disable a collector use the bare boolean false (not a quoted "false", 0, or null).`
            );
        }
    }

    //a collector stanza with "enabled": false is kept in config (documented,
    //easy to switch on) but not loaded. Anything other than an explicit false
    //(missing/true) loads, so enabling is the default and disabling is opt-in.
    const enabled = userCollectors.filter(c => (c as { enabled?: unknown }).enabled !== false);
    const skipped = userCollectors.length - enabled.length;
    if (skipped > 0) {
        const names = userCollectors
            .filter(c => (c as { enabled?: unknown }).enabled === false)
            .map(c => (c as { description?: string; plugin?: string }).description ?? (c as { plugin?: string }).plugin)
            .join(', ');
        log.info(`Agent: ${skipped} collector(s) disabled in config (not loaded): ${names}`);
    }

    //the internal heartbeat always rides along after the (enabled) user collectors
    return Promise.all(
        [...enabled, heartbeat].map(async collectorConfig => {
            const pluginParams = { site, targets, ...(collectorConfig as object) } as unknown;

            if (!isDataCollectorParams(pluginParams)) {
                throw new Error(
                    `In plugin config processing: Invalid plugin params in conf: ${JSON.stringify(
                        pluginParams,
                        null,
                        2
                    )}`
                );
            }

            const { plugin } = pluginParams;

            const { default: Plugin } = (await import(`./collectors/${plugin}.js`)) as {
                default: new (n: DataCollectorParams) => DataCollector;
            };
            return new Plugin(pluginParams);
        })
    );
};
