import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { PollingCollector } from '../collectors.js';
const conf = await confFromFS();
const VREP_STYLE = 10;
export default class VersionCollector extends PollingCollector {
    format(data, fh) {
        return fh.e(data, VREP_STYLE).done;
    }
    execPerInterval() {
        this.send(`${conf?.appName ?? 'Fluidity'} Agent ${conf?.appVersion ?? ''}`);
    }
}
