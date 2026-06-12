import { FSConfigUtil } from '#@shared/modules/config.js';
export const confFromFS = async () => {
    const c = (await FSConfigUtil.asyncNew()).conf;
    if (!c)
        throw new Error('watcher: missing or empty config');
    if (typeof c.watch !== 'string' || !c.watch) {
        throw new Error('watcher: conf.watch (the server base URL to subscribe to) is required');
    }
    return c;
};
