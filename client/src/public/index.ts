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

const testObj = { foo1: { bar: 'baz', word: 'blah' }, foo2: 'hi' };

logger.error(testObj);

logger.info('hi Im info in the browser');
logger.debug('hi Im debug data in the browser');
logger.warn('hi Im a warning in the browser');
logger.error('hi Im an error in the browser');

//2
