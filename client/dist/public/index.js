import { fetchLogger } from '#@shared/modules/logger.js';
import { configFromDOM } from '#@shared/modules/config.js';
const c = configFromDOM();
const log = fetchLogger(c);
log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');
log.debug(c);
//# sourceMappingURL=index.js.map