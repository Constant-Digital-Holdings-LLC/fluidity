import { Router, RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { FluidityController } from './controller.js';
import { isApiKeyFormat } from '#@shared/types.js';
import { MyConfigData } from '#@shared/modules/fluidityConfig.js';

//minimal X-Api-Key check, replacing @vpriem/express-api-key-auth
//(its bundled express 4 typings clash with express 5)
const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

const apiKeyAuth = (keys: string[]): RequestHandler => {
    //hash once at construction; per-request comparison is over fixed-length
    //digests with timingSafeEqual and no early exit, so response timing
    //leaks nothing about how much of a candidate key matched
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

export const makeRouter = (
    conf: MyConfigData | undefined,
    controller: FluidityController,
    //populateDOM feeds res.locals that ONLY the EJS views consume; it is
    //applied per view route here rather than globally, so the hot ingest
    //paths (POST /FIFO, GET /SSE) don't pay for view-rendering setup
    populateDOM: RequestHandler
): Router => {
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
    } else {
        throw new Error('Invalid permitted key or key list format');
    }

    return router;
};
