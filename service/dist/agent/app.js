import { asyncLogger } from '#@shared/modules/logger.js';
import { asyncConfig } from '#@shared/modules/config.js';
const config = await asyncConfig();
const log = await asyncLogger();
log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');
log.debug(`conf: ${JSON.stringify(config)}`);
