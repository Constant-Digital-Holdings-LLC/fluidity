import { LoggerUtil, LoggerConfig, levelsArr } from '#@shared/modules/logger.js';

export const inBrowser = (): Boolean => {
    return typeof window === 'object' && typeof process === 'undefined';
};

export const isErrnoException = (object: Error): object is NodeJS.ErrnoException => {
    return (
        Object.prototype.hasOwnProperty.call(object, 'code') || Object.prototype.hasOwnProperty.call(object, 'errno')
    );
};

export const prettyFsNotFound = (err: Error): Promise<string | undefined> => {
    return new Promise((resolve, reject) => {
        if (inBrowser()) {
            return reject('function not suitable for browser execution, no FS');
        } else {
            if (isErrnoException(err) && err.code === 'ENOENT') {
                import('url').then(({ fileURLToPath }) => {
                    if (typeof err.path === 'string') {
                        return resolve(`Cannot find path: ${fileURLToPath(new URL(err.path, import.meta.url))}`);
                    } else {
                        return resolve(undefined);
                    }
                });
            } else {
                return resolve(undefined);
            }
        }
    });
};

export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

export const isJSONString = (str: string) => {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
};

//Application Specific Customizations of logger:
export const fetchLogger = (conf?: LoggerConfig): LoggerUtil => {
    return LoggerUtil.new(conf => {
        const { logLevel, locLevel, logFormat } = conf || {};

        if (inBrowser()) {
            return LoggerUtil.browserConsole({ logLevel, locLevel });
        } else {
            if (levelsArr.indexOf(logLevel || 'debug') >= levelsArr.indexOf('info') && logFormat === 'JSON') {
                return LoggerUtil.JSONEmitter({ logLevel, locLevel });
            } else {
                return LoggerUtil.nodeConsole({ logLevel, locLevel });
            }
        }
    });
};
