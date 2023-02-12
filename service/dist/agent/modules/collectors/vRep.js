import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { PollingCollector } from '../collectors.js';
const conf = await confFromFS();
export default class VersionCollector extends PollingCollector {
    execPerInterval() {
        this.send(`${conf?.appName ?? 'Fluidity'} Agent ${conf?.appVersion ?? ''}`);
    }
}
