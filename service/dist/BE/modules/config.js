import fs from 'fs';
import YAML from 'yaml';
export let config = {};
try {
    const commonConfig = YAML.parse(fs.readFileSync('./commonConfig.yaml', 'utf8'));
    const devConfig = YAML.parse(fs.readFileSync('./devConfig.yaml', 'utf8'));
    const prodConfig = YAML.parse(fs.readFileSync('./prodConfig.yaml', 'utf8'));
    process.env['NODE_ENV'] === 'development'
        ? (config = Object.assign(commonConfig, devConfig))
        : (config = Object.assign(commonConfig, prodConfig));
}
catch (err) {
    console.error(err);
}
