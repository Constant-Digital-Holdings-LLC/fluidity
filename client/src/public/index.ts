import { fetchLogger } from '#@shared/modules/logger.js';
import { configFromDOM } from '#@shared/modules/config.js';
import { TestType } from '#@shared/types.js';
const config = configFromDOM();
const log = fetchLogger();

log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');

log.debug(config);
