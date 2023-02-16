import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityClient } from './modules/fluidityClient.js';

const conf = confFromDOM();

if (!conf) throw new Error('Missing Fluidity Client Config');

const log = fetchLogger(conf);
log.debug(conf);

const fc = new FluidityClient();
fc.sayHi();
