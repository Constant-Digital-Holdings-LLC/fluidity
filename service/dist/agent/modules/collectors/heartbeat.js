import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { PollingCollector } from '../collectors.js';
const conf = await confFromFS();
export default class HeartbeatCollector extends PollingCollector {
    execPerInterval() {
        if (conf?.appName && conf.appVersion) {
            this.send(`HB: ${conf.appName} Agent ${conf.appVersion}`);
        }
        else {
            this.send('HB: Fluidity Agent');
        }
    }
}
