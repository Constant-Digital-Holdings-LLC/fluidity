import https from 'https';
import fs from 'fs';
import express from 'express';
// import { RingBuffer } from 'ring-buffer-ts';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
import { fetchLogger, MyConfigData } from '#@shared/modules/application.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { httpLogger } from '#@shared/modules/logger.js';
import { config, configMiddleware } from '#@shared/modules/config.js';
import { WithRequired } from '#@shared/modules/utils.js';

const conf: WithRequired<MyConfigData, 'port' | 'tlsKey' | 'tlsCert' | 'httpCacheTTLSeconds'> = {
    appName: 'Fluidity',
    port: 443,
    tlsKey: 'ssl/prod-server_key.pem',
    tlsCert: 'ssl/prod-server_cert.pem',
    httpCacheTTLSeconds: 300,
    ...(await config())
};
const log = fetchLogger(conf);
log.debug(conf);

const app = express();
app.use(httpLogger(log));
app.use(await configMiddleware());
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('views', '../../../client/dist/views');

app.get('/', (req, res) => {
    res.render('index');
});

app.use(
    express.static('../../../client/dist/public', {
        maxAge: conf.httpCacheTTLSeconds * 1000
    })
);

try {
    https
        .createServer(
            {
                key: fs.readFileSync(conf['tlsKey']),
                cert: fs.readFileSync(conf['tlsCert'])
            },
            app
        )
        .listen(conf.port);

    log.info(`${conf.appName} ${conf.appVersion} server listening on port ${conf.port}`);
} catch (err) {
    if (err instanceof Error) {
        const formattedError = await prettyFsNotFound(err);

        log.error(formattedError || err);
    } else {
        log.error(err);
    }
}

const ringBuffer = new RingBuffer<number>(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);

// logger.info(ringBuffer.toArray());
