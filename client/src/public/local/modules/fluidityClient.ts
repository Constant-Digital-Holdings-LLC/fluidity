import { fetchLogger, confFromDOM } from '#@shared/modules/appResources.js';

const { conf } = confFromDOM();

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
