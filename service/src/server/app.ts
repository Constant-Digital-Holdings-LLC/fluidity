import { fetchLogger } from '#@shared/modules/logger.js';
import https from 'https';
import fs from 'fs';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { makeApp } from './modules/expressApp.js';

const conf = await confFromFS();
if (!conf) throw new Error('Missing Fluidity Service Config');

const log = fetchLogger(conf);

const app = makeApp(conf, log);

try {
    const PORT = conf.port ?? process.env['PORT'] ?? 80;

    if (typeof conf.appName !== 'string') {
        throw new Error(`appNaming missing from config`);
    }

    if (conf['tlsKey'] && conf['tlsCert'] && conf.port) {
        https
            .createServer(
                {
                    key: fs.readFileSync(conf['tlsKey']),
                    cert: fs.readFileSync(conf['tlsCert'])
                },
                app
            )
            .listen(conf.port);
    } else {
        app.listen(PORT);
    }

    log.info(`${conf.appName} ${conf.appVersion ?? ''} server listening on port: ${PORT}`);
} catch (err) {
    if (err instanceof Error) {
        const formattedError = await prettyFsNotFound(err);

        log.error(formattedError || err);
    } else {
        log.error(err);
    }
}
