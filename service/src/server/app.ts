import express from 'express';
// import { RingBuffer } from 'ring-buffer-ts';
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

app.get('/', (req, res) => {
    log.info(conf);
    res.render('index');
});

app.use(express.static('../../../client/dist/public', { maxAge: 1 }));

try {
    app.listen(port, (): void => {
        console.log(`Connected successfully on port ${port}`);
    });
} catch (err) {
    if (err instanceof Error) {
        console.error(err);
    }
}

const ringBuffer = new RingBuffer<number>(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);

// logger.info(ringBuffer.toArray());
