import { fetchLogger } from '#@shared/modules/logger.js';
import { configFromDOM } from '#@shared/modules/config.js';
const c = configFromDOM();
const log = fetchLogger(c);
class FluidityStorage {
}
class FluidityNetwork {
}
class FluidityUI {
}
export class FluidityClient {
    constructor() {
        this.ui = new FluidityUI();
        this.net = new FluidityNetwork();
        this.storage = new FluidityStorage();
    }
    sayHi() {
        log.info('Hi there !');
    }
}
//# sourceMappingURL=fluidityClient.js.map