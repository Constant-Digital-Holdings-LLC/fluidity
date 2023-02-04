import { fetchLogger } from '#@shared/modules/appResources.js';
import { DOMConfigUtil } from '#@shared/modules/config.js';
import { FluidityClient } from '#@client/modules/fluidityClient.js';
const { conf } = new DOMConfigUtil();
if (!conf)
    throw new Error('Missing Fluidity Client Config');
const log = fetchLogger(conf);
log.debug(conf);
const fc = new FluidityClient();
fc.sayHi();
//# sourceMappingURL=index.js.map