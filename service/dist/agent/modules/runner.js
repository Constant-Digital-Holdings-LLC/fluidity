import { isDataCollectorParams } from './collectors.js';
export const buildCollectors = async (conf) => {
    const { targets, site } = conf;
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
    const collectorsConf = conf['collectors'];
    if (!(Array.isArray(collectorsConf) && collectorsConf.length)) {
        throw new Error('In plugin config processing: no data collectors defined in configuration');
    }
    return Promise.all(collectorsConf.map(async (collectorConfig) => {
        const pluginParams = { site, targets, ...collectorConfig };
        if (!isDataCollectorParams(pluginParams)) {
            throw new Error(`In plugin config processing: Invalid plugin params in conf: ${JSON.stringify(pluginParams, null, 2)}`);
        }
        const { plugin } = pluginParams;
        const { default: Plugin } = (await import(`./collectors/${plugin}.js`));
        return new Plugin(pluginParams);
    }));
};
