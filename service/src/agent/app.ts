import { DataCollector, DataCollectorParams, isDataCollectorParams } from '#@service/modules/collectors.js';
import { config } from '#@shared/modules/config.js';
import { fetchLogger } from '#@shared/modules/utils.js';
const conf = await config();
const log = fetchLogger(conf);
log.debug(conf);

if (conf) {
    const { targets, site } = conf;
    let startQueue: DataCollector[] = [];

    try {
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            startQueue = await Promise.all(
                conf['collectors'].map(async collectorConfig => {
                    const pluginParams = { site, targets, ...collectorConfig } as unknown;
                    if (isDataCollectorParams(pluginParams)) {
                        const { plugin, description } = pluginParams;

                        const { default: Plugin } = (await import(`#@service/modules/collectors/${plugin}.js`)) as {
                            default: { new (n: DataCollectorParams): DataCollector };
                        };
                        return new Plugin(pluginParams);
                    } else {
                        throw new Error(
                            `In plugin config processing:\nInvalid plugin params in conf: ${JSON.stringify(
                                pluginParams,
                                null,
                                2
                            )}`
                        );
                    }
                })
            );
        } else {
            throw new Error('In plugin config processing:\nno data collectors defined in configuration');
        }
    } catch (err) {
        process.exitCode = 1;
        log.error(err);
    }

    try {
        if (startQueue.length) {
            startQueue.forEach(p => p.start());
        } else {
            throw new Error('no valid plugins in start queue');
        }
    } catch (err) {
        process.exitCode = 1;
        log.error('In collector plugin execution:\n');
        log.error(err);
    }
}
