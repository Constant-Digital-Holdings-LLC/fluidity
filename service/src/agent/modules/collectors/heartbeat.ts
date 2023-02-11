import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { DataCollectorPlugin, PollingCollector } from '../collectors.js';

const conf = await confFromFS();

export default class HeartbeatCollector extends PollingCollector implements DataCollectorPlugin {
    execPerInterval(): void {
        if (conf?.appName && conf.appVersion) {
            this.send(`HB: ${conf.appName} Agent ${conf.appVersion}`);
        } else {
            this.send('HB: Fluidity Agent');
        }
    }
}
