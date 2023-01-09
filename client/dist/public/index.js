import { fetchLogger } from '#@shared/modules/logger.js';
import { configFromDOM } from '#@shared/modules/config.js';
import { FluidityClient } from '#@client/modules/fluidityClient.js';
const c = configFromDOM();
const log = fetchLogger(c);
log.info(c);
const fc = new FluidityClient();
fc.sayHi();
//# sourceMappingURL=index.js.map