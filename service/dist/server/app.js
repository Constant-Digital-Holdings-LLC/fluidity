import express from 'express';
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
const testObj = { foo1: { bar: 'baz', word: 'blah' }, foo2: 'hi' };
logger.debug(testObj);
logger.error(testObj);
const app = express();
const port = 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('../../../client/dist/public', { maxAge: 1 }));
app.get('/', (_, res) => {
    logger.info('req made...');
    res.sendFile(path.join(__dirname, '../../../client/dist/public', './index.html'));
});
try {
    app.listen(port, () => {
        console.log(`Connected successfully on port ${port}`);
    });
}
catch (err) {
    if (err instanceof Error) {
        console.error(err);
    }
}
const ringBuffer = new RingBuffer(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);
logger.info(ringBuffer.toArray());
