import https from 'https';
import fs from 'fs';
import express from 'express';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
import { fetchLogger } from '#@shared/modules/logger.js';
import { config, configMiddleware } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
log.debug('this is debug data');
log.info('this is info data');
log.warn('this is warn data');
log.error('this is error data');
const port = 3000;
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
app.use(express.static('../../../client/dist/public', { maxAge: 1 }));
try {
    https
        .createServer({
        key: fs.readFileSync('./ssl/dev_key.pem'),
        cert: fs.readFileSync('./ssl/dev_cert.pem')
    }, app)
        .listen(port);
    log.info(`listening on port ${port}`);
}
catch (err) {
    log.error(err);
}
const ringBuffer = new RingBuffer(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);
