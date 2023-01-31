import { isDataCollectorParams } from '#@service/modules/collectors.js';
import { config } from '#@shared/modules/config.js';
import { fetchLogger } from '#@shared/modules/logger.js';
const conf = await config();
const log = fetchLogger(conf);
if (conf) {
    const { targets, site } = conf;
    let startQueue = [];
    try {
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            startQueue = await Promise.all(conf['collectors'].map(async (collectorConfig) => {
                const pluginParams = { site, targets, ...collectorConfig };
                if (isDataCollectorParams(pluginParams)) {
                    const { plugin, description } = pluginParams;
                    const { default: Plugin } = (await import(`#@service/modules/collectors/${plugin}.js`));
                    return new Plugin(pluginParams);
                }
                else {
                    throw new Error(`In plugin config processing:\nInvalid plugin params in conf: ${JSON.stringify(pluginParams, null, 2)}`);
                }
            }));
        }
        else {
            throw new Error('In plugin config processing:\nno data collectors defined in configuration');
        }
    }
    catch (err) {
        log.error(err);
        process.exitCode = 1;
    }
    try {
        startQueue.forEach(p => p.start());
    }
    catch (err) {
        log.error('In collector plugin execution:\n');
        log.error(err);
        process.exitCode = 1;
    }
}
