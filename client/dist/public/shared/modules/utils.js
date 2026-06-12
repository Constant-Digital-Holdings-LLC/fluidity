export const inBrowser = () => {
    return typeof window === 'object' && typeof process === 'undefined';
};
export const nodeEnv = () => inBrowser() ? null : process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
export const isErrnoException = (object) => {
    return (Object.prototype.hasOwnProperty.call(object, 'code') || Object.prototype.hasOwnProperty.call(object, 'errno'));
};
export const isCatastrophicRegex = (source) => {
    const unboundedBraceAt = (i) => /^\{\d*,\}/.test(source.slice(i, i + 12));
    const isStar = (ch) => ch === '*' || ch === '+';
    const stack = [];
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '\\') {
            i++;
            continue;
        }
        if (inClass) {
            if (c === ']')
                inClass = false;
            continue;
        }
        if (c === '[') {
            inClass = true;
        }
        else if (c === '(') {
            stack.push({ bodyUnbounded: false });
        }
        else if (isStar(c) || (c === '{' && unboundedBraceAt(i))) {
            const top = stack[stack.length - 1];
            if (top)
                top.bodyUnbounded = true;
        }
        else if (c === ')') {
            const grp = stack.pop();
            const next = source[i + 1];
            const quantified = isStar(next) || (next === '{' && unboundedBraceAt(i + 1));
            if ((grp === null || grp === void 0 ? void 0 : grp.bodyUnbounded) && quantified)
                return true;
            const top = stack[stack.length - 1];
            if (top && ((grp === null || grp === void 0 ? void 0 : grp.bodyUnbounded) || quantified))
                top.bodyUnbounded = true;
        }
    }
    return false;
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