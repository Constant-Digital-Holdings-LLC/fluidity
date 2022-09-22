import { logger } from '#@shared/modules/logger.js';
import { TestType } from '#@shared/types.js';

const Obj: TestType = {
    property1: 'foo',
    property2: 'bar',
    sayHi() {
        console.log(this.property1);
        return this.property2;
    }
};

Obj.sayHi();

logger.info('info - hi Im in the browser');
logger.debug('debug - hi Im in the browser');
logger.warn('warn - hi Im in the browser');
logger.error('error - hi Im in the browser');

//2
