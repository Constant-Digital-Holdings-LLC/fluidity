var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { loggerUtility } from '#@shared/modules/logger.js';
import { ConfigUtil } from '#@shared/modules/config.js';
const c = new ConfigUtil();
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const log = yield loggerUtility;
        log.debug('this is debug data');
        log.info('this is info data');
        log.warn('this is warn data');
        log.error('this is error data');
        log.debug(c.allConf);
    }
    catch (err) {
        console.error(err);
    }
}))();
//# sourceMappingURL=index.js.map