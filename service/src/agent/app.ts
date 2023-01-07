import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
import { GenericSerialCollector, SRS1serialCollector } from '#@service/modules/collectors.js';

const c = await config();
const log = fetchLogger(c);

// const port = new SerialPort({ path: 'COM10', baudRate: 9600 });

//this is the one:
// const parser = port.pipe(new RegexParser({ regex: />*[\r\n]*Reply: </g }));

// const parser = port.pipe(new RegexParser({ regex: /(?:>[\r\n])?Reply: </g }));
// const parser = port.pipe(new ReadlineParser({ delimiter: '>' }));
// const parser = port.pipe(new DelimiterParser({ delimiter: '\n' }));
// parser.on('data', console.log);

log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');

log.debug(`conf: ${JSON.stringify(c)}`);

if (typeof c?.['site'] === 'string' && Array.isArray(c['destinations'])) {
    const gsc = new GenericSerialCollector({
        path: 'COM10',
        baudRate: 9600,
        site: c['site'],
        label: 'SomeDevice',
        collectorType: 'generic-serial',
        destinations: c['destinations']
    });

    gsc.listen();
}

if (typeof c?.['site'] === 'string' && Array.isArray(c['destinations'])) {
    const srs = new SRS1serialCollector({
        path: 'COM4',
        baudRate: 9600,
        site: c['site'],
        label: 'SRS',
        collectorType: 'srs1-serial',
        destinations: c['destinations']
    });

    srs.listen();
}
