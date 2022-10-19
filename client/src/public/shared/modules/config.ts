import { LogLevel, levelsArr, loggerUtility } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';

//write middleware function which does the EJS to place the public conf items in data-* elems

interface Config {
    log_level?: LogLevel;
    loc_level?: LogLevel;
}

interface RootConfig {
    public?: Config;
    private?: Config;
}

let commonConf: RootConfig | undefined;
let devConf: RootConfig | undefined;
let prodConf: RootConfig | undefined;

const getMergedConf = (): Promise<RootConfig> => {
    return new Promise((resolve, reject) => {
        if (!inBrowser()) {
            import('fs').then(fs => {
                const { readFileSync: read } = fs;
                import('yaml').then(YAML => {
                    const { parse } = YAML;

                    try {
                        commonConf ??= parse(read('./conf/common_conf.yaml', 'utf8'));
                        devConf ??= parse(read('./conf/dev_conf.yaml', 'utf8'));
                        prodConf ??= parse(read('./conf/prod_conf.yaml', 'utf8'));
                    } catch (err) {
                        console.error(`could not read and parse config file(s)`);
                        return reject(err);
                    }

                    if (commonConf && devConf && prodConf) {
                        if (process.env['NODE_ENV'] === 'development') {
                            resolve({
                                public: { ...devConf?.public, ...commonConf?.public },
                                private: { ...devConf?.private, ...commonConf?.private }
                            });
                        } else {
                            resolve({
                                public: { ...prodConf?.public, ...commonConf?.public },
                                private: { ...prodConf?.private, ...commonConf?.private }
                            });
                        }
                    } else {
                        return reject('could not parse one or more config files');
                    }
                });
            });
        } else {
            return reject('getMergedConf() called in the browser, codepath requires fs!');
        }
    });
};

export const config: Promise<Config> = new Promise((resolve, reject) => {
    if (inBrowser()) {
        //get conf from DOM
        resolve({ log_level: 'debug' });
    } else {
        getMergedConf()
            .then(c => {
                resolve({ ...c.public, ...c.private });
            })
            .catch(err => {
                return reject(err);
            });
    }
});
