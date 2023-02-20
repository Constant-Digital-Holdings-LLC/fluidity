import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
const conf = confFromDOM();
const log = fetchLogger(conf);
export class FluidityUI {
    paint(pos, fpArr) {
        log.info(`paint ${pos}: ${JSON.stringify(fpArr)}`);
    }
    constructor(history) {
        var _a;
        this.history = history;
        this.demarc = (_a = history.at(-1)) === null || _a === void 0 ? void 0 : _a.seq;
        this.paint('before', history);
    }
    add(fp) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.paint('after', [fp]);
            }
        }
    }
}
//# sourceMappingURL=fluidityClient.js.map