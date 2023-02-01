import { LoggerUtil } from '#@shared/modules/logger.js';
import { configFromDOM } from '#@shared/modules/config.js';
const conf = configFromDOM();
const log = LoggerUtil.new(conf);
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