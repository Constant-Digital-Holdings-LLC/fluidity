import https from 'https';
import fs from 'fs';
import express from 'express';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
import { fetchLogger } from '#@shared/modules/logger.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { config, configMiddleware } from '#@shared/modules/config.js';
const conf = {
    appName: 'Fluidity',
    port: 443,
    tlsKey: 'ssl/prod-server_key.pem',
    tlsCert: 'ssl/prod-server_cert.pem',
    httpCacheTTLSeconds: 300,
    ...(await config())
};
const log = fetchLogger(conf);
log.info(`Server Configuration:\n${JSON.stringify(conf, undefined, '\t')}`);
const app = express();
app.use(await configMiddleware());
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', '../../../client/dist/views');
app.get('/', (req, res) => {
    log.info(`${req.method} ${req.url}\t${res.statusCode} `);
    res.render('index');
});
app.use(express.static('../../../client/dist/public', {
    maxAge: conf.httpCacheTTLSeconds * 1000
}));
try {
    https
        .createServer({
        key: fs.readFileSync(conf['tlsKey']),
        cert: fs.readFileSync(conf['tlsCert'])
    }, app)
        .listen(conf.port);
    log.info(`${conf.appName} ${conf.appVersion} server listening on port ${conf.port}`);
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
const ringBuffer = new RingBuffer(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);
