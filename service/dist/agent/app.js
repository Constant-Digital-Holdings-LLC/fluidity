import { buildCollectors } from './modules/runner.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
process.on('unhandledRejection', (reason, promise) => {
    console.error(reason);
    console.error(promise);
    process.exit(1);
});
process.on('uncaughtException', reason => {
    console.error(reason);
    process.exit(1);
});
const conf = await confFromFS();
if (!conf)
    throw new Error('Missing Fluidity Agent Config');
const log = fetchLogger();
log.debug(conf);
let startQueue = [];
try {
    startQueue = await buildCollectors(conf);
}
catch (err) {
    log.error(err);
    process.exit(1);
}
try {
    if (startQueue.length) {
        startQueue.forEach(p => p.start());
    }
    else {
        throw new Error('no valid plugins in start queue');
    }
}
catch (err) {
    log.error('In collector plugin execution: ');
    log.error(err);
    process.exit(1);
}
