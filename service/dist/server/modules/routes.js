import { Router } from 'express';
const apiKeyAuth = (keys) => (req, res, next) => {
    const key = req.header('x-api-key');
    if (key && keys.includes(key)) {
        next();
        return;
    }
    res.status(401).json({ error: 'unauthorized' });
};
export const makeRouter = (conf, controller) => {
    const router = Router();
    router.get('/', (req, res) => {
        res.render('index');
    });
    router.get('/about', (req, res) => {
        res.render('about');
    });
    router.get('/FIFO', controller.GET);
    router.get('/SSE', controller.SSE);
    const permittedKeys = process.env['PERMITTED_KEY'] ? [process.env['PERMITTED_KEY']] : conf?.permittedKeys;
    if (!permittedKeys) {
        throw new Error('server missing PERMITTED_KEY env var or permitted key list in conf');
    }
    if (Array.isArray(permittedKeys) &&
        permittedKeys.every(pk => typeof pk === 'string' && /^[a-zA-Z0-9]+$/.test(pk))) {
        router.post('/FIFO', apiKeyAuth(permittedKeys), controller.POST);
    }
    else {
        throw new Error('Invalid permitted key or key list format');
    }
    return router;
};
