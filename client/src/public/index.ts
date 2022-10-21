import { syncLogger } from '#@shared/modules/logger.js';
import { TestType } from '#@shared/types.js';
import { syncConfig } from '#@shared/modules/config.js';

const config = syncConfig();
const log = syncLogger();

log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');

log.debug(config);
