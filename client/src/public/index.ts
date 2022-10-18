import { logger } from '#@shared/modules/logger.js';
import { TestType } from '#@shared/types.js';

import { config } from '#@shared/modules/config.js';

logger.debug('this is debug data');

logger.error(config);
