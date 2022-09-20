import { test } from '#@shared/modules/logger.js';
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

test();

//1
