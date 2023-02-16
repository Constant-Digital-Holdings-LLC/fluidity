import { fetchLogger } from '#@shared/modules/logger.js';
import https from 'https';
import fs from 'fs';
import express from 'express';
import { confFromFS, pubSafe } from '#@shared/modules/fluidityConfig.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { httpLogger } from '#@shared/modules/logger.js';
import { DOMConfigUtil } from '#@shared/modules/config.js';
import { router } from './modules/routes.js';

const conf = await confFromFS();
if (!conf) throw new Error('Missing Fluidity Service Config');

const log = fetchLogger(conf);

const app = express();
app.use(httpLogger(log));
const dcu = new DOMConfigUtil(conf, pubSafe);
app.use(dcu.populateDOM.bind(dcu));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', './views');
app.use('', router);

app.use(
    express.static('../../../client/dist/public', {
        maxAge: (conf.httpCacheTTLSeconds ?? 5) * 1000
    })
);

try {
    if (typeof conf.appName !== 'string') {
        throw new Error(`appNaming missing from config`);
    }

    if (conf['tlsKey'] && conf['tlsCert']) {
        https
            .createServer(
                {
                    key: fs.readFileSync(conf['tlsKey']),
                    cert: fs.readFileSync(conf['tlsCert'])
                },
                app
            )
            .listen(conf.port);

        log.info(`${conf.appName} ${conf.appVersion ?? ''} server listening on port: ${conf.port ?? 'not set'}`);
    } else {
        throw new Error(`missing tls config`);
    }
} catch (err) {
    if (err instanceof Error) {
        const formattedError = await prettyFsNotFound(err);

        log.error(formattedError || err);
    } else {
        log.error(err);
    }
}
