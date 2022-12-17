import { fileURLToPath } from 'url';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const log = fetchLogger(await config());
export const isErrnoException = (object) => {
    return (Object.prototype.hasOwnProperty.call(object, 'code') || Object.prototype.hasOwnProperty.call(object, 'errno'));
};
export const handledFsNotFound = (err) => {
    if (isErrnoException(err)) {
        if (err.code === 'ENOENT') {
            if (typeof err.path === 'string') {
                log.error(`Cannot find path: ${fileURLToPath(new URL(err.path, import.meta.url))}`);
                return true;
            }
        }
    }
    return false;
};
