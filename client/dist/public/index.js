import { syncLogger } from '#@shared/modules/logger.js';
import { ConfigUtil } from '#@shared/modules/config.js';
const c = new ConfigUtil();
const log = syncLogger();
log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');
log.debug(c.allConf);
//# sourceMappingURL=index.js.map