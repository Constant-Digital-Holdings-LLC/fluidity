import { buildCollectors } from './modules/runner.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';
process.on('unhandledRejection', (reason, promise) => {
    console.error(reason);
    console.error(promise);
});
process.on('uncaughtException', reason => {
    console.error(reason);
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
    process.exitCode = 1;
    log.error(err);
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
    process.exitCode = 1;
    log.error('In collector plugin execution: ');
    log.error(err);
}
