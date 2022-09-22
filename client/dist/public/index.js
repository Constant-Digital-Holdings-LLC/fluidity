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
logger.info('hi Im in the browser');
//# sourceMappingURL=index.js.map