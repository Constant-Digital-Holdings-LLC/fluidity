import { loggerUtility } from '#@shared/modules/logger.js';
const log = await loggerUtility;
log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');
