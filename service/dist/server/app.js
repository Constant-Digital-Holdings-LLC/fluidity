import { fetchLogger } from '#@shared/modules/logger.js';
import https from 'https';
import http from 'http';
import fs from 'fs';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { makeApp } from './modules/expressApp.js';
const conf = await confFromFS();
if (!conf)
    throw new Error('Missing Fluidity Service Config');
const log = fetchLogger(conf);
const app = makeApp(conf, log);
try {
    const PORT = conf.port ?? process.env['PORT'] ?? 80;
    if (typeof conf.appName !== 'string') {
        throw new Error(`appNaming missing from config`);
    }
    const server = conf['tlsKey'] && conf['tlsCert'] && conf.port
        ? https.createServer({
            key: fs.readFileSync(conf['tlsKey']),
            cert: fs.readFileSync(conf['tlsCert'])
        }, app)
        : http.createServer(app);
    server.on('error', err => {
        log.error(`server failed to start on port ${PORT}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
    server.listen(PORT, () => {
        log.info(`${conf.appName} ${conf.appVersion ?? ''} server listening on port: ${PORT}`);
    });
}
catch (err) {
    if (err instanceof Error) {
        const formattedError = await prettyFsNotFound(err);
        log.error(formattedError || err);
    }
    else {
        log.error(err);
    }
}
