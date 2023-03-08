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
const permittedKeys = process.env['PERMITTED_KEY'] ? [process.env['PERMITTED_KEY']] : conf?.permittedKeys;
if (!permittedKeys) {
    throw new Error('server missing PERMITTED_KEY env var or permitted key list in conf');
}
if (Array.isArray(permittedKeys) && permittedKeys.every(pk => typeof pk === 'string' && /^[a-zA-Z0-9]+$/.test(pk))) {
    router.post('/FIFO', apiKeyAuth(permittedKeys), POST);
}
else {
    throw new Error('Invalid permitted key or key list format');
}
