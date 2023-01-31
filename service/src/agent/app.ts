import { DataCollector, DataCollectorParams, isDataCollectorParams } from '#@service/modules/collectors.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
if (conf) {
    const { targets, site } = conf;

    try {
        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            await Promise.all(
                conf['collectors'].map(async collectorConfig => {
                    const pluginParams = { site, targets, ...collectorConfig } as unknown;

                    if (isDataCollectorParams(pluginParams)) {
                        const { plugin, description } = pluginParams;

                        try {
                            const { default: Plugin } = (await import(`#@service/modules/collectors/${plugin}.js`)) as {
                                default: { new (n: DataCollectorParams): DataCollector };
                            };

                            new Plugin(pluginParams).start();
                        } catch (err) {
                            console.error(`plugin load error: ${plugin} [${description}]`);
                            if (err instanceof Error) console.error(err.stack);
                            process.exit();
                        }
                    } else {
                        throw new Error(`Invalid plugin params in conf: ${JSON.stringify(pluginParams, null, 2)}`);
                    }
                })
            );
        } else {
            throw new Error('no data collectors defined in configuration');
        }
    } catch (err) {
        console.error(err);
        process.exit();
    }
}
