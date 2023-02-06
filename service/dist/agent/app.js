import { isDataCollectorParams } from './modules/collectors.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
const conf = await confFromFS();
if (!conf)
    throw new Error('Missing Fluidity Agent Config');
const log = fetchLogger();
log.debug(conf);
if (conf) {
    const { targets, site } = conf;
    let startQueue = [];
    try {
        if (!targets) {
            throw new Error('no targets defined');
        }
        if (!targets.every(({ location }) => {
            return new URL(location).protocol === 'https:' || new URL(location).protocol === 'http:';
        })) {
            throw new Error(`only https/http protocols are supported: ${JSON.stringify(targets.map(t => t.location))}`);
        }
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            startQueue = await Promise.all(conf['collectors'].map(async (collectorConfig) => {
                const pluginParams = { site, targets, ...collectorConfig };
                if (isDataCollectorParams(pluginParams)) {
                    const { plugin, description } = pluginParams;
                    const { default: Plugin } = (await import(`./modules/collectors/${plugin}.js`));
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
        process.exitCode = 1;
        log.error(err);
    }
    try {
        if (startQueue.length) {
            startQueue.forEach(p => p.start());
        }
        else {
            throw new Error('no valid plugins in start queue');
        }
    }
    catch (err) {
        process.exitCode = 1;
        log.error('In collector plugin execution:\n');
        log.error(err);
    }
}
