import { fetchLogger } from '#@shared/modules/logger.js';
import { isApiKeyFormat } from '#@shared/types.js';
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
    const enabled = collectorsConf.filter(c => c.enabled !== false);
    const skipped = collectorsConf.length - enabled.length;
    if (skipped > 0) {
        const names = collectorsConf
            .filter(c => c.enabled === false)
            .map(c => c.description ?? c.plugin)
            .join(', ');
        log.info(`Agent: ${skipped} collector(s) disabled in config (not loaded): ${names}`);
    }
    return Promise.all(enabled.map(async (collectorConfig) => {
        const pluginParams = { site, targets, ...collectorConfig };
        if (!isDataCollectorParams(pluginParams)) {
            throw new Error(`In plugin config processing: Invalid plugin params in conf: ${JSON.stringify(pluginParams, null, 2)}`);
        }
        const { plugin } = pluginParams;
        const { default: Plugin } = (await import(`./collectors/${plugin}.js`));
        return new Plugin(pluginParams);
    }));
};
