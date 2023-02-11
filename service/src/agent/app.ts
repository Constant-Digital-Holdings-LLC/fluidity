import { DataCollector, DataCollectorParams, isDataCollectorParams } from './modules/collectors.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { fetchLogger } from '#@shared/modules/logger.js';

const conf = await confFromFS();
if (!conf) throw new Error('Missing Fluidity Agent Config');

const log = fetchLogger();
log.debug(conf);

if (conf) {
    const { targets, site } = conf;

    let startQueue: DataCollector[] = [];

    try {
        if (typeof site !== 'string') {
            throw new Error(`in main config: a site name (string) must be defined for this agent (site: ${site})`);
        }

        if (!targets) {
            throw new Error(`in main config: no targets defined to publish to (targets: ${JSON.stringify(targets)})`);
        }

        if (
            !targets.every(({ location, key }) => {
                return new URL(location).protocol === 'https:' && key;
            })
        ) {
            throw new Error(
                `in main config: targets must be HTTPS and an Api Key needs to be specified: ${JSON.stringify(
                    targets.map(t => t.location)
                )}`
            );
        }

        if (Array.isArray(conf['collectors']) && conf['collectors'].length) {
            startQueue = await Promise.all(
                conf['collectors'].map(async collectorConfig => {
                    const pluginParams = { site, targets, ...collectorConfig } as unknown;
                    if (isDataCollectorParams(pluginParams)) {
                        const { plugin, description } = pluginParams;

                        const { default: Plugin } = (await import(`./modules/collectors/${plugin}.js`)) as {
                            default: { new (n: DataCollectorParams): DataCollector };
                        };
                        return new Plugin(pluginParams);
                    } else {
                        throw new Error(
                            `In plugin config processing: Invalid plugin params in conf: ${JSON.stringify(
                                pluginParams,
                                null,
                                2
                            )}`
                        );
                    }
                })
            );
        } else {
            throw new Error('In plugin config processing: no data collectors defined in configuration');
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
        log.error('In collector plugin execution: ');
        log.error(err);
    }
}
