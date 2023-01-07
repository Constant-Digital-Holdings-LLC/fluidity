import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
import { SRS1serialCollector } from '#@service/modules/collectors.js';
const c = await config();
const log = fetchLogger(c);
log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');
log.debug(`conf: ${JSON.stringify(c)}`);
if (typeof c?.['site'] === 'string' && Array.isArray(c['destinations'])) {
    const srs = new SRS1serialCollector({
        path: 'COM10',
        baudRate: 9600,
        site: c['site'],
        label: 'foo',
        collectorType: 'srs1-serial',
        destinations: c['destinations']
    });
    srs.listen();
}
