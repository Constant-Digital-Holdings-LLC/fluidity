import { fetchLogger } from '#@shared/modules/logger.js';
import https from 'https';
import http from 'http';
import fs from 'fs';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { prettyFsNotFound } from '#@shared/modules/utils.js';
import { makeApp } from './modules/expressApp.js';

const conf = await confFromFS();
if (!conf) throw new Error('Missing Fluidity Service Config');

const log = fetchLogger(conf);

const app = makeApp(conf, log);

try {
    const PORT = conf.port ?? process.env['PORT'] ?? 80;

    if (typeof conf.appName !== 'string') {
        throw new Error(`appNaming missing from config`);
    }

    //half-configured TLS is a misconfiguration, not a cue to fall back to
    //plaintext - the agent only ever publishes to https:// targets
    if (Boolean(conf['tlsKey']) !== Boolean(conf['tlsCert'])) {
        throw new Error('tlsKey and tlsCert must be configured together');
    }

    //build the server explicitly (not app.listen) so the 'error' handler is
    //attached before listen() - app.on(...) would bind the Express emitter,
    //not the underlying server that emits bind failures.
    //TLS is decided by the key material alone: the port may legitimately
    //arrive via the PORT env var, and that must not silently disable HTTPS
    const useTls = Boolean(conf['tlsKey'] && conf['tlsCert']);
    const server = useTls
        ? https.createServer(
              {
                  key: fs.readFileSync(conf['tlsKey'] as string),
                  cert: fs.readFileSync(conf['tlsCert'] as string)
              },
              app
          )
        : http.createServer(app);

    //listen() is async: bind failures (EADDRINUSE/EACCES) arrive as an 'error'
    //event, not as a throw, so the try/catch above can't see them. Without
    //this handler an unhandled 'error' would crash the process opaquely.
    server.on('error', err => {
        log.error(`server failed to start on port ${PORT}: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });

    //...and the "listening" log must wait for the event, not fire optimistically
    server.listen(PORT, () => {
        log.info(
            `${conf.appName} ${conf.appVersion ?? ''} server listening on port: ${PORT} (${useTls ? 'https' : 'http'})`
        );
    });
} catch (err) {
    if (err instanceof Error) {
        const formattedError = await prettyFsNotFound(err);

        log.error(formattedError || err);
    } else {
        log.error(err);
    }
    //startup failed (e.g. missing TLS material): no server holds the loop
    //open, so the process is about to exit - make sure it exits non-zero so
    //a supervisor's on-failure restart/alerting actually fires (the async
    //bind-failure path above exits 1 for the same reason)
    process.exitCode = 1;
}
