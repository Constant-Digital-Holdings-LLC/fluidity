import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
import { GenericSerialCollector, SRSserialCollector } from '#@service/modules/collectors.js';
import { CollectorType } from '#@shared/types.js';

const conf = await config();
const log = fetchLogger(conf);

log.info(`Agent Configuration:\n${JSON.stringify(conf, undefined, '\t')}`);

if (conf) {
    const { targets, site } = conf;

    try {
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            conf['collectors'].forEach(collectorConfig => {
                switch (collectorConfig.collectorType as CollectorType) {
                    case 'generic-serial':
                        new GenericSerialCollector({ site, targets, ...collectorConfig }).start();
                        break;
                    case 'srs-serial':
                        new SRSserialCollector({ site, targets, ...collectorConfig }).start();
                        break;
                    default:
                        throw new Error(`no collectors found for type ${collectorConfig.collectorType}`);
                }
            });
        } else {
            throw new Error('no data collectors defined in configuration');
        }
    } catch (err) {
        log.error(err);
    }
}
