import express, { Express } from 'express';
import { fileURLToPath } from 'node:url';
import { fetchLogger, httpLogger, LoggerUtil } from '#@shared/modules/logger.js';
import { MyConfigData, pubSafe } from '#@shared/modules/fluidityConfig.js';
import { DOMConfigUtil } from '#@shared/modules/config.js';
import { makeController, FluidityController } from './controller.js';
import { makeRouter } from './routes.js';

//paths anchored to this module (dist/server/modules) so the app works from any cwd
const VIEWS_DIR = fileURLToPath(new URL('../views', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('../../../../client/dist/public', import.meta.url));

export const makeApp = (
    conf: MyConfigData,
    log: LoggerUtil = fetchLogger(conf),
    controller: FluidityController = makeController(conf, log)
): Express => {
    const app = express();

    app.use(httpLogger(log));

    const dcu = new DOMConfigUtil(conf, pubSafe);

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.set('view engine', 'ejs');
    app.set('views', VIEWS_DIR);
    //populateDOM is scoped to the view routes inside makeRouter (it only sets
    //EJS locals); mounting it globally taxed every POST /FIFO and SSE request
    app.use('/', makeRouter(conf, controller, dcu.populateDOM.bind(dcu)));

    app.use(
        express.static(PUBLIC_DIR, {
            maxAge: (conf.httpCacheTTLSeconds ?? 5) * 1000
        })
    );

    return app;
};
