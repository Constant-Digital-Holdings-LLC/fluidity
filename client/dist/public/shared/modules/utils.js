export const inBrowser = () => {
    return typeof window === 'object' && typeof process === 'undefined';
};
export const isErrnoException = (object) => {
    return (Object.prototype.hasOwnProperty.call(object, 'code') || Object.prototype.hasOwnProperty.call(object, 'errno'));
};
export function* counter() {
    let c = 1;
    while (true) {
        yield c;
        c++;
    }
}
export const prettyFsNotFound = (err) => {
    return new Promise((resolve, reject) => {
        if (inBrowser()) {
            return reject(new Error('function not suitable for browser execution, no FS'));
        }
        else {
            if (isErrnoException(err) && err.code === 'ENOENT') {
                import('url')
                    .then(({ fileURLToPath }) => {
                    if (typeof err.path === 'string') {
                        return resolve(`Cannot find path: ${fileURLToPath(new URL(err.path, import.meta.url))}`);
                    }
                    else {
                        return resolve(undefined);
                    }
                })
                    .catch(() => {
                    console.error('Error in dynamic import of url module');
                    resolve(undefined);
                });
            }
            else {
                return resolve(undefined);
            }
        }
    });
};
export const isJSONString = (str) => {
    try {
        JSON.parse(str);
    }
    catch (_a) {
        return false;
    }
    return true;
};
//# sourceMappingURL=utils.js.map