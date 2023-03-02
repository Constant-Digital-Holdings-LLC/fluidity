var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { FSConfigUtil, DOMConfigUtil } from '#@shared/modules/config.js';
export const pubSafe = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv', 'maxClientHistory'];
export const confFromDOM = () => {
    return new DOMConfigUtil().conf;
};
export const confFromFS = () => __awaiter(void 0, void 0, void 0, function* () {
    return (yield FSConfigUtil.asyncNew()).conf;
});
//# sourceMappingURL=fluidityConfig.js.map