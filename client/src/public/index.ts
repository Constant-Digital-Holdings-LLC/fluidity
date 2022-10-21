import { loggerUtility } from '#@shared/modules/logger.js';
import { TestType } from '#@shared/types.js';

import { ConfigUtil } from '#@shared/modules/config.js';

const c = new ConfigUtil();

(async () => {
    try {
        const log = await loggerUtility;

        log.debug('this is debug data');
        log.info('this is info data');
        log.warn('this is warn data');
        log.error('this is error data');

        log.debug(c.allConf);
    } catch (err) {
        console.error(err);
    }
})();
