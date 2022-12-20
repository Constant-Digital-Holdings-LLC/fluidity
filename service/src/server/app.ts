import https from 'https';
import fs from 'fs';
import express from 'express';
// import { RingBuffer } from 'ring-buffer-ts';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
import { fetchLogger } from '#@shared/modules/logger.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { config, configMiddleware } from '#@shared/modules/config.js';
import { MyConfigData } from '#@shared/modules/my_config.js';
import { WithRequired } from '#@shared/modules/utils.js';

const conf: WithRequired<MyConfigData, 'port' | 'tls_key' | 'tls_cert' | 'http_cache_ttl_seconds'> = {
    app_name: 'Fluidity',
    port: 443,
    tls_key: 'ssl/prod-server_key.pem',
    tls_cert: 'ssl/prod-server_cert.pem',
    http_cache_ttl_seconds: 300,
    ...(await config())
};

const log = fetchLogger(conf);

const app = express();
app.use(await configMiddleware());
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('views', '../../../client/dist/views');

app.get('/', (req, res) => {
    log.info(conf);
    res.render('index');
});

log.debug(conf);

app.use(
    express.static('../../../client/dist/public', {
        maxAge: conf.http_cache_ttl_seconds * 1000
    })
);

try {
    https
        .createServer(
            {
                key: fs.readFileSync(conf['tls_key']),
                cert: fs.readFileSync(conf['tls_cert'])
            },
            app
        )
        .listen(conf.port);

    log.info(`${conf.app_name} ${conf.app_version} server listening on port ${conf.port}`);
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
