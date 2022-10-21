import { asyncLogger } from '#@shared/modules/logger.js';
import { ConfigUtil } from '#@shared/modules/config.js';
const c = await ConfigUtil.load();
const log = await asyncLogger();
log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');
log.debug(`conf: ${JSON.stringify(c.allConf)}`);
