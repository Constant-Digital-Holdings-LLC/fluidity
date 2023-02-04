import { fetchLogger } from '#@shared/modules/logger.js';
import https from 'https';
import fs from 'fs';
import express from 'express';
// import { RingBuffer } from 'ring-buffer-ts';
import rb_pgk from 'ring-buffer-ts';
const { RingBuffer } = rb_pgk;
import { confFromFS, pubSafe } from '#@shared/modules/fluidityConfig.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { httpLogger } from '#@shared/modules/logger.js';
import { DOMConfigUtil } from '#@shared/modules/config.js';

const conf = await confFromFS();
if (!conf) throw new Error('Missing Fluidity Service Config');

const log = fetchLogger(conf);

const app = express();
app.use(httpLogger(log));
const dcu = new DOMConfigUtil(conf, pubSafe);
app.use(dcu.populateDOM.bind(dcu));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('views', '../../../client/dist/views');

app.get('/', (req, res) => {
    res.render('index');
});

app.use(
    express.static('../../../client/dist/public', {
        maxAge: (conf.httpCacheTTLSeconds ?? 5) * 1000
    })
);

try {
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

        log.info(`${conf.appName} ${conf.appVersion} server listening on port ${conf.port}`);
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

const ringBuffer = new RingBuffer<number>(5);
ringBuffer.add(1);
ringBuffer.add(2, 3);
ringBuffer.add(4, 5, 6);

// logger.info(ringBuffer.toArray());
