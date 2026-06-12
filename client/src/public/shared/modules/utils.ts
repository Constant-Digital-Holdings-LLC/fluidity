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

//Best-effort detector for the most common catastrophic-backtracking shape: an
//unbounded quantifier (*, +, {n,}) applied to a group whose body itself
//contains an unbounded quantifier - e.g. (a+)+, (.*)*, ((ab)+)*. That is what
//turns a 40-char line into seconds of CPU. Operator-supplied regexes (logTail
//tokenize rules, watcher selectors) are run against attacker-influenced text,
//so a well-meaning but vulnerable pattern is a DoS; callers reject these at
//config time (loud, per the misconfig-throws doctrine). It does NOT catch
//every ReDoS (alternation overlap like (a|a)* slips through), so it is a guard,
//not a proof - the line-length cap still backstops polynomial cases.
export const isCatastrophicRegex = (source: string): boolean => {
    const unboundedBraceAt = (i: number): boolean => /^\{\d*,\}/.test(source.slice(i, i + 12));
    const isStar = (ch: string | undefined): boolean => ch === '*' || ch === '+';
    const stack: { bodyUnbounded: boolean }[] = [];
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '\\') {
            i++; //skip the escaped char - an escaped (, ), *, { is a literal
            continue;
        }
        if (inClass) {
            if (c === ']') inClass = false;
            continue;
        }
        if (c === '[') {
            inClass = true;
        } else if (c === '(') {
            stack.push({ bodyUnbounded: false });
        } else if (isStar(c) || (c === '{' && unboundedBraceAt(i))) {
            const top = stack[stack.length - 1];
            if (top) top.bodyUnbounded = true;
        } else if (c === ')') {
            const grp = stack.pop();
            const next = source[i + 1];
            const quantified = isStar(next) || (next === '{' && unboundedBraceAt(i + 1));
            if (grp?.bodyUnbounded && quantified) return true;
            //the closed group contributes an unbounded quantifier to the
            //parent's body if its own body had one ( ((a+))+ ) or if the group
            //itself is unbounded-quantified ( ((ab)+)+ )
            const top = stack[stack.length - 1];
            if (top && (grp?.bodyUnbounded || quantified)) top.bodyUnbounded = true;
        }
    }
    return false;
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
