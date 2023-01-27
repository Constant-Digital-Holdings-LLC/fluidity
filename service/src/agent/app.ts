import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
if (conf) {
    const { targets, site } = conf;

    try {
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            await Promise.all(
                conf['collectors'].map(async collectorConfig => {
                    const { name, description } = collectorConfig;
                    log.info(`Loading collector: ${name} [${description}]`);
                    try {
                        const { default: Plugin } = await import(`#@service/modules/collectors/${name}.js`);
                        new Plugin({ site, targets, ...collectorConfig }).start();
                    } catch (err) {
                        log.error(`plugin load error: ${name} [${description}]`);
                    }
                })
            );
        } else {
            throw new Error('no data collectors defined in configuration');
        }
    } catch (err) {
        log.error(err);
    }
}
