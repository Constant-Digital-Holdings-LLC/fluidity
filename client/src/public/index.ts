import { fetchLogger } from '#@shared/modules/utils.js';
import { configFromDOM } from '#@shared/modules/config.js';
import { FluidityClient } from '#@client/modules/fluidityClient.js';

const conf = configFromDOM();
const log = fetchLogger(conf);
log.debug(conf);

const fc = new FluidityClient();
fc.sayHi();

//foo
