import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { DataCollectorPlugin, PollingCollector } from '../collectors.js';

const conf = await confFromFS();

export default class VersionCollector extends PollingCollector implements DataCollectorPlugin {
    execPerInterval(): void {
        this.send(`${conf?.appName ?? 'Fluidity'} Agent ${conf?.appVersion ?? ''}`);
    }
}
