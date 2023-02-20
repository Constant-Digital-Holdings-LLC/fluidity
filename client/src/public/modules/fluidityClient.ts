import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket } from '#@shared/types.js';

const conf = confFromDOM();
const log = fetchLogger(conf);

export class FluidityUI {
    protected demarc: number | undefined;
    protected paint(pos: 'before' | 'after', fpArr: FluidityPacket[]) {
        log.info(`paint ${pos}: ${JSON.stringify(fpArr)}`);
    }

    constructor(protected history: FluidityPacket[]) {
        this.demarc = history.at(-1)?.seq;
        this.paint('before', history);
    }

    add(fp: FluidityPacket) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.paint('after', [fp]);
            }
        }
    }
}
