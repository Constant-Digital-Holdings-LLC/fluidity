import { LogLevel, levelsArr, loggerUtility } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';

interface Config {
    log_level?: LogLevel;
    loc_level?: LogLevel;
}

interface RootConfig {
    public?: Config;
    private?: Config;
}

export let config: Promise<Config>;

const getMergedConf = (): Promise<RootConfig> => {
    return new Promise((resolve, reject) => {
        if (!inBrowser()) {
            import('fs').then(fs => {
                const { readFileSync: read } = fs;
                import('yaml').then(YAML => {
                    const { parse } = YAML;

                    try {
                        const commonConf = parse(read('./conf/common_conf.yaml', 'utf8'));
                        const devConf = parse(read('./conf/dev_conf.yaml', 'utf8'));
                        const prodConf = parse(read('./conf/prod_conf.yaml', 'utf8'));

                        if (process.env['NODE_ENV'] === 'development') {
                            resolve({
                                public: { ...devConf.public, ...commonConf.public },
                                private: { ...devConf.private, ...commonConf.private }
                            });
                        } else {
                            resolve({
                                public: { ...prodConf.public, ...commonConf.public },
                                private: { ...prodConf.private, ...commonConf.private }
                            });
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        } else {
            resolve({
                public: {},
                private: {}
            });
        }
    });
};

config = new Promise((resolve, reject) => {
    if (inBrowser()) {
        //get conf from DOM
        resolve({ log_level: 'debug' });
    } else {
        getMergedConf()
            .then(c => {
                resolve({ ...c.public, ...c.private });
            })
            .catch(err => {
                reject(err);
            });
    }
});
