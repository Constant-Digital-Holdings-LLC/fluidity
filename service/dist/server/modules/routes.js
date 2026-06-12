import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isApiKeyFormat } from '#@shared/types.js';
const sha256 = (s) => createHash('sha256').update(s).digest();
const apiKeyAuth = (keys) => {
    const keyDigests = keys.map(sha256);
    return (req, res, next) => {
        const key = req.header('x-api-key');
        if (key) {
            const candidate = sha256(key);
            let matched = false;
            for (const kd of keyDigests) {
                if (timingSafeEqual(candidate, kd)) {
                    matched = true;
                }
            }
            if (matched) {
                next();
                return;
            }
        }
        res.status(401).json({ error: 'unauthorized' });
    };
};
export const makeRouter = (conf, controller, populateDOM) => {
    const router = Router();
    router.get('/', populateDOM, (req, res) => {
        res.render('index');
    });
    router.get('/about', populateDOM, (req, res) => {
        res.render('about');
    });
    router.get('/FIFO', controller.GET);
    router.get('/SSE', controller.SSE);
    const permittedKeys = process.env['PERMITTED_KEY'] ? [process.env['PERMITTED_KEY']] : conf?.permittedKeys;
    if (!permittedKeys) {
        throw new Error('server missing PERMITTED_KEY env var or permitted key list in conf');
    }
    if (Array.isArray(permittedKeys) && permittedKeys.every(pk => isApiKeyFormat(pk))) {
        router.post('/FIFO', apiKeyAuth(permittedKeys), controller.POST);
    }
    else {
        throw new Error('Invalid permitted key or key list format');
    }
    return router;
};
