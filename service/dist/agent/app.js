import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
if (conf) {
    const { targets, site } = conf;
    try {
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            await Promise.all(conf['collectors'].map(async (collectorConfig) => {
                const { name, description } = collectorConfig;
                log.info(`\nLoading collector: ${name} [${description}]`);
                const { default: Plugin } = await import(`#@service/modules/collectors/${name}.js`);
                log.debug('Here:');
                log.debug(Plugin);
                new Plugin({ site, targets, ...collectorConfig }).start();
            }));
        }
        else {
            throw new Error('no data collectors defined in configuration');
        }
    }
    catch (err) {
        log.error(err);
    }
}
