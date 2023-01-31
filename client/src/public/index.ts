import { fetchLogger } from '#@shared/modules/logger.js';
import { configFromDOM } from '#@shared/modules/config.js';
import { FluidityClient } from '#@client/modules/fluidityClient.js';

const conf = configFromDOM();
const log = fetchLogger(conf);
log.info(`Client Configuration:\n${JSON.stringify(conf, undefined, '\t')}`);

const fc = new FluidityClient();
fc.sayHi();

//foo
