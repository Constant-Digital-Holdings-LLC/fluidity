#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { detectCaps, ColorMode } from './modules/caps.js';
import { shouldVerifyTLS, FollowHandle } from './modules/transport.js';
import { runStream } from './modules/stream.js';
import { runInteractive } from './modules/interactive.js';

const HELP = `fluidity-tui - terminal client for Fluidity

Usage: fluidity-tui [options]

  --server URL        Fluidity service base URL
                      (default: FLUIDITY_SERVER env, else https://localhost:3000)
  --follow            force stream mode (currently the only mode)
  --json              raw FluidityPacket NDJSON output
  --site NAME         pre-filter by site (repeatable)
  --collector NAME    pre-filter by collector/plugin (repeatable)
  --history N         max history packets rendered on connect (default 4000)
  --color MODE        auto | never | 16 | 256 | truecolor (default auto)
  --show-urls         append URLs after link names
  --insecure          accept self-signed/invalid TLS certificates
  --version, --help
`;

const fail = (msg: string): never => {
    process.stderr.write(`fluidity-tui: ${msg}\n`);
    process.exit(1);
};

const main = (): void => {
    let args;
    try {
        args = parseArgs({
            options: {
                server: { type: 'string' },
                follow: { type: 'boolean', default: false },
                json: { type: 'boolean', default: false },
                site: { type: 'string', multiple: true, default: [] },
                collector: { type: 'string', multiple: true, default: [] },
                history: { type: 'string', default: '4000' },
                color: { type: 'string', default: 'auto' },
                'show-urls': { type: 'boolean', default: false },
                insecure: { type: 'boolean', default: false },
                version: { type: 'boolean', default: false },
                help: { type: 'boolean', default: false }
            }
        }).values;
    } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
    }

    if (args.help) {
        process.stdout.write(HELP);
        return;
    }
    if (args.version) {
        const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
            version: string;
        };
        process.stdout.write(`fluidity-tui ${pkg.version}\n`);
        return;
    }

    const colorModes = ['auto', 'never', '16', '256', 'truecolor'];
    if (!colorModes.includes(args.color)) {
        return fail(`--color must be one of: ${colorModes.join(', ')}`);
    }

    const history = parseInt(args.history, 10);
    if (!Number.isInteger(history) || history < 0) {
        return fail('--history must be a non-negative integer');
    }

    const usedDefaultServer = !args.server && !process.env['FLUIDITY_SERVER'];
    const serverRaw = args.server ?? process.env['FLUIDITY_SERVER'] ?? 'https://localhost:3000';

    let base: URL;
    try {
        base = new URL(serverRaw);
    } catch {
        return fail(`invalid server URL: ${serverRaw}`);
    }

    if (base.protocol === 'https:' && !shouldVerifyTLS(base, args.insecure) && !args.insecure) {
        process.stderr.write(`fluidity-tui: loopback server - TLS verification relaxed\n`);
    }

    const caps = detectCaps(process.env, Boolean(process.stdout.isTTY), args.color as ColorMode);

    //interactive on a real terminal; stream mode when piped or forced
    const interactive = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY) && !args.follow && !args.json;

    if (interactive) {
        runInteractive(
            {
                base,
                insecure: args.insecure,
                filters: { sites: args.site, collectors: args.collector },
                caps,
                showUrls: args['show-urls'],
                historyLimit: history
            },
            () => process.exit(0)
        );
        return;
    }

    //spec §6: exit 2 if the server is unreachable at startup; once a
    //connection has ever succeeded, retry forever
    let everConnected = false;

    const handle: FollowHandle = runStream({
        base,
        insecure: args.insecure,
        json: args.json,
        filters: { sites: args.site, collectors: args.collector },
        render: { caps, showUrls: args['show-urls'] },
        historyLimit: history,
        out: line => process.stdout.write(`${line}\n`),
        status: (state, detail) => {
            if (state === 'live') everConnected = true;

            process.stderr.write(detail ? `fluidity-tui: ${state} (${detail})\n` : `fluidity-tui: ${state}\n`);

            if (state === 'reconnecting' && !everConnected) {
                handle.stop();
                process.stderr.write(`fluidity-tui: cannot reach ${base.href}`);
                process.stderr.write(usedDefaultServer ? ' - no --server given, tried the local default\n' : '\n');
                process.exit(2);
            }
        }
    });

    const quit = (): void => {
        handle.stop();
        process.exit(0);
    };
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
};

main();
