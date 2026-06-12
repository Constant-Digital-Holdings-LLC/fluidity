import type { NodeEnv } from '#@shared/types.js';

export const inBrowser = (): boolean => {
    return typeof window === 'object' && typeof process === 'undefined';
};

//the one place the environment is classified - the TLS-verification gate in
//the agent and the config loader must never disagree on what 'development' is
export const nodeEnv = (): NodeEnv =>
    inBrowser() ? null : process.env['NODE_ENV'] === 'development' ? 'development' : 'production';

export const isErrnoException = (object: Error): object is NodeJS.ErrnoException => {
    return (
        Object.prototype.hasOwnProperty.call(object, 'code') || Object.prototype.hasOwnProperty.call(object, 'errno')
    );
};

export function* counter(): IterableIterator<number> {
    let c = 1;
    while (true) {
        yield c;
        c++;
    }
}

export const prettyFsNotFound = (err: Error): Promise<string | undefined> => {
    return new Promise((resolve, reject) => {
        if (inBrowser()) {
            return reject(new Error('function not suitable for browser execution, no FS'));
        } else {
            if (isErrnoException(err) && err.code === 'ENOENT') {
                import('node:path')
                    .then(path => {
                        if (typeof err.path === 'string') {
                            //resolve against cwd - where readFileSync actually
                            //looked - not against this module's own location
                            return resolve(`Cannot find path: ${path.resolve(err.path)}`);
                        } else {
                            return resolve(undefined);
                        }
                    })
                    .catch(() => {
                        //settle the outer promise even if the import fails, or
                        //the awaiting caller (config loadFiles) hangs forever
                        console.error('Error in dynamic import of path module');
                        resolve(undefined);
                    });
            } else {
                return resolve(undefined);
            }
        }
    });
};
