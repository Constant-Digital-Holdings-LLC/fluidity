import { logger } from '#@shared/modules/logger.js';
const Obj = {
    property1: 'foo',
    property2: 'bar',
    sayHi() {
        console.log(this.property1);
        return this.property2;
    }
};
Obj.sayHi();
logger.info('hi Im info in the browser');
logger.debug('hi Im debug data in the browser');
logger.warn('hi Im a warning in the browser');
logger.error('hi Im an error in the browser');
//# sourceMappingURL=index.js.map