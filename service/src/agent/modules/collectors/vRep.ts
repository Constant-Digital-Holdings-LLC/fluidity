import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData } from '#@shared/types.js';
import { DataCollectorPlugin, FormatHelper, PollingCollector } from '../collectors.js';

const conf = await confFromFS();

//style 10 is --dark, the quiet tone in both client palettes: vRep is the
//internal liveness heartbeat, so its packet should keep a site alive on the
//dashboard without drawing the eye - the version string is incidental
const VREP_STYLE = 10;

export default class VersionCollector extends PollingCollector implements DataCollectorPlugin {
    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data, VREP_STYLE).done;
    }

    execPerInterval(): void {
        this.send(`${conf?.appName ?? 'Fluidity'} Agent ${conf?.appVersion ?? ''}`);
    }
}
