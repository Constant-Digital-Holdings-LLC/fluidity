import { DataCollector } from './modules/collectors.js';
import { buildCollectors } from './modules/runner.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';

//crash-only: after an uncaught throw the process is in an unknown state -
//a collector's timer chain or stream pipeline may be dead while the process
//looks healthy to a supervisor. Exit non-zero and let the supervisor restart
//us; expected failures (serial disconnects, upstream errors) are handled at
//their sources and never reach here.
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
if (!conf) throw new Error('Missing Fluidity Agent Config');

const log = fetchLogger();
log.debug(conf);

let startQueue: DataCollector[] = [];

try {
    startQueue = await buildCollectors(conf);
} catch (err) {
    log.error(err);
    //a partial build leaves already-constructed collectors holding open
    //serial ports (SerialPort opens in the constructor) with no handle to
    //stop() them - without a hard exit the event loop never drains and a
    //zombie process blocks the serial devices
    process.exit(1);
}

try {
    if (startQueue.length) {
        startQueue.forEach(p => p.start());
    } else {
        throw new Error('no valid plugins in start queue');
    }
} catch (err) {
    log.error('In collector plugin execution: ');
    log.error(err);
    process.exit(1);
}
