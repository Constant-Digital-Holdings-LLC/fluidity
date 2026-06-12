export const inBrowser = () => {
    return typeof window === 'object' && typeof process === 'undefined';
};
export const nodeEnv = () => inBrowser() ? null : process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
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
                import('node:path')
                    .then(path => {
                    if (typeof err.path === 'string') {
                        return resolve(`Cannot find path: ${path.resolve(err.path)}`);
                    }
                    else {
                        return resolve(undefined);
                    }
                })
                    .catch(() => {
                    console.error('Error in dynamic import of path module');
                    resolve(undefined);
                });
            }
            else {
                return resolve(undefined);
            }
        }
    });
};
//# sourceMappingURL=utils.js.map