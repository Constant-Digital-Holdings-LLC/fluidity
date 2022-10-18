import { inBrowser } from '#@shared/modules/utils.js';
export let config;
const getMergedConf = () => {
    return new Promise((resolve, reject) => {
        if (!inBrowser()) {
            import('fs').then(fs => {
                const { readFileSync: read } = fs;
                import('yaml').then(YAML => {
                    const { parse } = YAML;
                    const commonConf = parse(read('./conf/common_conf.yaml', 'utf8'));
                    const devConf = parse(read('./conf/dev_conf.yaml', 'utf8'));
                    const prodConf = parse(read('./conf/prod_conf.yaml', 'utf8'));
                    if (process.env['NODE_ENV'] === 'development') {
                        resolve({
                            public: Object.assign(Object.assign({}, devConf.public), commonConf.public),
                            private: Object.assign(Object.assign({}, devConf.private), commonConf.private)
                        });
                    }
                    else {
                        resolve({
                            public: Object.assign(Object.assign({}, prodConf.public), commonConf.public),
                            private: Object.assign(Object.assign({}, prodConf.private), commonConf.private)
                        });
                    }
                });
            });
        }
        else {
            resolve({
                public: {},
                private: {}
            });
        }
    });
};
config = new Promise((resolve, reject) => {
    if (inBrowser()) {
        resolve({ log_level: 'info' });
    }
    else {
        getMergedConf().then(c => {
            resolve(Object.assign(Object.assign({}, c.public), c.private));
        });
    }
});
//# sourceMappingURL=config.js.map