import { fetchLogger } from '#@shared/modules/utils.js';
import { configFromDOM } from '#@shared/modules/config.js';

const conf = configFromDOM();
const log = fetchLogger(conf);

class FluidityStorage {}

class FluidityNetwork {}

class FluidityUI {}

export class FluidityClient {
    public ui: FluidityUI;
    public net: FluidityNetwork;
    public storage: FluidityStorage;

    constructor() {
        this.ui = new FluidityUI();
        this.net = new FluidityNetwork();
        this.storage = new FluidityStorage();
    }

    sayHi(): void {
        log.info('Hi there !');
    }
}
