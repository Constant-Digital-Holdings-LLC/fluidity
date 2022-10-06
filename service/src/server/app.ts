import express, { Application, Request, Response } from 'express';
// import { RingBuffer } from 'ring-buffer-ts';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
import path from 'path';
import { logger } from '#@shared/modules/logger.js';

logger.debug('debug 1 - nodejs');
logger.debug('debug 2 - nodejs');

logger.info('info 1 - nodejs');
logger.info('info 2 - nodejs');

logger.warn('warn 1 - nodejs');
logger.warn('warn 2 - nodejs');

logger.error('error 1 - nodejs');
logger.error('error 2 - nodejs');

// setInterval(_ => {
//     logger.debug('debug 1 - nodejs');
//     logger.debug('debug 2 - nodejs');

//     logger.info('info 1 - nodejs');
//     logger.info('info 2 - nodejs');

//     logger.warn('warn 1 - nodejs');
//     logger.warn('warn 2 - nodejs');

//     logger.error('error 1 - nodejs');
//     logger.error('error 2 - nodejs');
// }, 250);

const app: Application = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//5min cache ttl:
// app.use(express.static('../../../client/dist/public', { maxAge: 300000 }));
app.use(express.static('../../../client/dist/public', { maxAge: 1 }));

app.get('/', (_, res) => {
    logger.info('req made...');
    res.sendFile(path.join(__dirname, '../../../client/dist/public', './index.html'));
});

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

logger.info(ringBuffer.toArray());
