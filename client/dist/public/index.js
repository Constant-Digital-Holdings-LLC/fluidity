import { LoggerUtil } from '#@shared/modules/logger.js';
import { configFromDOM } from '#@shared/modules/config.js';
import { FluidityClient } from '#@client/modules/fluidityClient.js';
const conf = configFromDOM();
const log = LoggerUtil.new(conf);
log.debug(conf);
const fc = new FluidityClient();
fc.sayHi();
//# sourceMappingURL=index.js.map