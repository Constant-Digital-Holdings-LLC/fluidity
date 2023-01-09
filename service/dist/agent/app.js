import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
import { GenericSerialCollector, SRSserialCollector } from '#@service/modules/collectors.js';
const conf = await config();
const log = fetchLogger(conf);
if (conf) {
    const { targets, site } = conf;
    try {
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            conf['collectors'].forEach(collectorConfig => {
                switch (collectorConfig.collectorType) {
                    case 'generic-serial':
                        new GenericSerialCollector({ site, targets, ...collectorConfig }).listen();
                        break;
                    case 'srs-serial':
                        new SRSserialCollector({ site, targets, ...collectorConfig }).listen();
                        break;
                    default:
                        throw new Error(`no collectors found for type ${collectorConfig.collectorType}`);
                }
            });
        }
        else {
            throw new Error('no data collectors defined in configuration');
        }
    }
    catch (err) {
        log.error(err);
    }
}
