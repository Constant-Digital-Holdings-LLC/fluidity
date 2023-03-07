import { Router } from 'express';
import { GET, POST, SSE } from './controller.js';
import { apiKeyAuth } from '@vpriem/express-api-key-auth';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
const conf = await confFromFS();

export const router = Router();

router.get('/', (req, res) => {
    res.render('index');
});

router.get('/FIFO', GET);
router.get('/SSE', SSE);

if (conf?.permittedKeys && Array.isArray(conf.permittedKeys)) {
    if (conf.permittedKeys.every(k => typeof k === 'string')) {
        router.post('/FIFO', apiKeyAuth(conf.permittedKeys as string[]), POST);
    } else {
        throw new Error('expected array of API keys as strings in conf');
    }
} else {
    throw new Error('missing permittedKeys list in server conf');
}
