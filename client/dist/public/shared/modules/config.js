import { inBrowser } from '#@shared/modules/utils.js';
let commonConf;
let devConf;
let prodConf;
const getMergedConf = () => {
    return new Promise((resolve, reject) => {
        if (!inBrowser()) {
            import('fs').then(fs => {
                const { readFileSync: read } = fs;
                import('yaml').then(YAML => {
                    const { parse } = YAML;
                    try {
                        commonConf !== null && commonConf !== void 0 ? commonConf : (commonConf = parse(read('./conf/common_conf.yaml', 'utf8')));
                        devConf !== null && devConf !== void 0 ? devConf : (devConf = parse(read('./conf/dev_conf.yaml', 'utf8')));
                        prodConf !== null && prodConf !== void 0 ? prodConf : (prodConf = parse(read('./conf/prod_conf.yaml', 'utf8')));
                    }
                    catch (err) {
                        console.error(`could not read and parse config file(s)`);
                        return reject(err);
                    }
                    if (commonConf && devConf && prodConf) {
                        if (process.env['NODE_ENV'] === 'development') {
                            resolve({
                                public: Object.assign(Object.assign({}, devConf === null || devConf === void 0 ? void 0 : devConf.public), commonConf === null || commonConf === void 0 ? void 0 : commonConf.public),
                                private: Object.assign(Object.assign({}, devConf === null || devConf === void 0 ? void 0 : devConf.private), commonConf === null || commonConf === void 0 ? void 0 : commonConf.private)
                            });
                        }
                        else {
                            resolve({
                                public: Object.assign(Object.assign({}, prodConf === null || prodConf === void 0 ? void 0 : prodConf.public), commonConf === null || commonConf === void 0 ? void 0 : commonConf.public),
                                private: Object.assign(Object.assign({}, prodConf === null || prodConf === void 0 ? void 0 : prodConf.private), commonConf === null || commonConf === void 0 ? void 0 : commonConf.private)
                            });
                        }
                    }
                    else {
                        return reject('could not parse one or more config files');
                    }
                });
            });
        }
        else {
            return reject('getMergedConf() called in the browser, codepath requires fs!');
        }
    });
};
export const config = new Promise((resolve, reject) => {
    if (inBrowser()) {
        resolve({ log_level: 'debug' });
    }
    else {
        getMergedConf()
            .then(c => {
            resolve(Object.assign(Object.assign({}, c.public), c.private));
        })
            .catch(err => {
            return reject(err);
        });
    }
});
//# sourceMappingURL=config.js.map