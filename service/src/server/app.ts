import https from 'https';
import fs from 'fs';
import express from 'express';
// import { RingBuffer } from 'ring-buffer-ts';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
import { fetchLogger } from '#@shared/modules/logger.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { config, ConfigData, configMiddleware } from '#@shared/modules/config.js';

const conf: ConfigData = (await config()) ?? { app_name: 'Fluidity (w/o config)' };
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
        maxAge: (typeof conf['http_cache_ttl_seconds'] === 'number' ? conf['http_cache_ttl_seconds'] : 1) * 1000
    })
);

const PORT: number = typeof conf['port'] === 'number' ? conf['port'] : 3000;

try {
    if (typeof conf['tls_key'] === 'string' && typeof conf['tls_cert'] === 'string') {
        https
            .createServer(
                {
                    key: fs.readFileSync(conf['tls_key']),
                    cert: fs.readFileSync(conf['tls_cert'])
                },
                app
            )
            .listen(PORT);

        log.info(`${conf.app_name} ${conf.app_version} server listening on port ${PORT}`);
    } else {
        throw new Error('missing TLS config for server');
    }
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
