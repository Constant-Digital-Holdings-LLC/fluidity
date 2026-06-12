import { fetchLogger } from '#@shared/modules/logger.js';
import { isApiKeyFormat, HEARTBEAT_SEC } from '#@shared/types.js';
import { isDataCollectorParams } from './collectors.js';
export const buildCollectors = async (conf) => {
    const { targets, site } = conf;
    const log = fetchLogger(conf);
    if (typeof site !== 'string') {
        throw new Error(`in main config: a site name (string) must be defined for this agent (site: ${JSON.stringify(site)})`);
    }
    if (!targets) {
        throw new Error(`in main config: no targets defined to publish to (targets: ${JSON.stringify(targets)})`);
    }
    if (!targets.every(({ location, key }) => {
        return new URL(location).protocol === 'https:' && key;
    })) {
        throw new Error(`in main config: targets must be HTTPS and an Api Key needs to be specified: ${JSON.stringify(targets.map(t => t.location))}`);
    }
    if (!targets.every(({ key }) => isApiKeyFormat(key))) {
        throw new Error('in main config: target API keys must be alphanumeric - consider using the bin/genApiKey utility');
    }
    const collectorsConf = conf['collectors'];
    if (!(Array.isArray(collectorsConf) && collectorsConf.length)) {
        throw new Error('In plugin config processing: no data collectors defined in configuration');
    }
    const collectorList = collectorsConf;
    const hbRaw = conf['heartbeatSec'];
    const heartbeatSec = typeof hbRaw === 'number' && hbRaw > 0 ? hbRaw : HEARTBEAT_SEC;
    const heartbeat = { description: 'Agent Report', plugin: 'vRep', pollIntervalSec: heartbeatSec };
    const userCollectors = collectorList.filter(c => c.plugin !== 'vRep');
    const configuredVRep = collectorList.length - userCollectors.length;
    if (configuredVRep > 0) {
        log.warn(`Agent: ${configuredVRep} configured "vRep" stanza(s) ignored - vRep is now an internal liveness ` +
            `heartbeat fixed at ${heartbeatSec}s. Remove it from collectors (set conf.heartbeatSec to tune the rate).`);
    }
    for (const c of userCollectors) {
        const e = c.enabled;
        if (e !== undefined && typeof e !== 'boolean') {
            const name = c.description ?? c.plugin ?? '(unnamed)';
            log.warn(`Agent: collector "${name}" has a non-boolean "enabled" value (${JSON.stringify(e)}) - it will LOAD. ` +
                `To disable a collector use the bare boolean false (not a quoted "false", 0, or null).`);
        }
    }
    const enabled = userCollectors.filter(c => c.enabled !== false);
    const skipped = userCollectors.length - enabled.length;
    if (skipped > 0) {
        const names = userCollectors
            .filter(c => c.enabled === false)
            .map(c => c.description ?? c.plugin)
            .join(', ');
        log.info(`Agent: ${skipped} collector(s) disabled in config (not loaded): ${names}`);
    }
    return Promise.all([...enabled, heartbeat].map(async (collectorConfig) => {
        const pluginParams = { site, targets, ...collectorConfig };
        if (!isDataCollectorParams(pluginParams)) {
            throw new Error(`In plugin config processing: Invalid plugin params in conf: ${JSON.stringify(pluginParams, null, 2)}`);
        }
        const { plugin } = pluginParams;
        const { default: Plugin } = (await import(`./collectors/${plugin}.js`));
        return new Plugin(pluginParams);
    }));
};
