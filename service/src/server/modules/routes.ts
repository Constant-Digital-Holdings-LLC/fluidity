import { Router, RequestHandler } from 'express';
import { FluidityController } from './controller.js';
import { MyConfigData } from '#@shared/modules/fluidityConfig.js';

//minimal X-Api-Key check, replacing @vpriem/express-api-key-auth
//(its bundled express 4 typings clash with express 5)
const apiKeyAuth =
    (keys: string[]): RequestHandler =>
    (req, res, next) => {
        const key = req.header('x-api-key');

        if (key && keys.includes(key)) {
            next();
            return;
        }

        res.status(401).json({ error: 'unauthorized' });
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

    if (
        Array.isArray(permittedKeys) &&
        permittedKeys.every(pk => typeof pk === 'string' && /^[a-zA-Z0-9]+$/.test(pk))
    ) {
        router.post('/FIFO', apiKeyAuth(permittedKeys), controller.POST);
    } else {
        throw new Error('Invalid permitted key or key list format');
    }

    return router;
};
