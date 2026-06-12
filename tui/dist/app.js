#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { detectCaps } from './modules/caps.js';
import { shouldVerifyTLS } from './modules/transport.js';
import { normalizeServerUrl } from './modules/serverUrl.js';
import { runStream } from './modules/stream.js';
import { runInteractive } from './modules/interactive.js';
const HELP = `fluidity-tui - terminal client for Fluidity

Usage: fluidity-tui [server-url] [options]

  server-url          Fluidity service URL, e.g. f-y.io or https://host:3000
                      (scheme optional, defaults to https; falls back to the
                      FLUIDITY_SERVER env, else https://localhost:3000)
  --server URL        same as the positional server-url (kept for compatibility)
  --follow            force stream mode even on a TTY
  --json              raw FluidityPacket NDJSON output
  --site NAME         pre-filter by site (repeatable)
  --collector NAME    pre-filter by collector/plugin (repeatable)
  --history N         max history packets rendered on connect (default 4000)
  --color MODE        auto | never | 16 | 256 | truecolor (default auto)
  --show-urls         append URLs after link names
  --insecure          accept self-signed/invalid TLS certificates
  --version, --help
`;
const fail = (msg) => {
    process.stderr.write(`fluidity-tui: ${msg}\n`);
    process.exit(1);
};
const main = () => {
    let parsed;
    try {
        parsed = parseArgs({
            allowPositionals: true,
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
        });
    }
    catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
    }
    const args = parsed.values;
    const positionals = parsed.positionals;
    if (args.help) {
        process.stdout.write(HELP);
        return;
    }
    if (args.version) {
        let version = process.env['FLUIDITY_TUI_VERSION'] ?? 'unknown';
        try {
            const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
            version = pkg.version;
        }
        catch {
        }
        process.stdout.write(`fluidity-tui ${version}\n`);
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
    if (positionals.length > 1) {
        return fail(`unexpected extra argument(s): ${positionals.slice(1).join(' ')}`);
    }
    const positionalServer = positionals[0];
    if (positionalServer !== undefined && args.server !== undefined) {
        return fail('specify the server once: as the first argument or with --server, not both');
    }
    const serverArg = positionalServer ?? args.server;
    const usedDefaultServer = serverArg === undefined && !process.env['FLUIDITY_SERVER'];
    const serverRaw = serverArg ?? process.env['FLUIDITY_SERVER'] ?? 'https://localhost:3000';
    let base;
    try {
        base = normalizeServerUrl(serverRaw);
    }
    catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
    }
    if (base.protocol === 'https:' && !shouldVerifyTLS(base, args.insecure) && !args.insecure) {
        process.stderr.write(`fluidity-tui: loopback server - TLS verification relaxed\n`);
    }
    const caps = detectCaps(process.env, Boolean(process.stdout.isTTY), args.color);
    const unreachable = () => {
        process.stderr.write(`fluidity-tui: cannot reach ${base.href}`);
        process.stderr.write(usedDefaultServer ? ' - no server given, tried the local default\n' : '\n');
        return process.exit(2);
    };
    const interactive = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY) && !args.follow && !args.json;
    if (interactive) {
        runInteractive({
            base,
            insecure: args.insecure,
            filters: { sites: args.site, collectors: args.collector },
            caps,
            showUrls: args['show-urls'],
            historyLimit: history,
            onStartupFailure: unreachable
        }, () => process.exit(0));
        return;
    }
    let everConnected = false;
    const handle = runStream({
        base,
        insecure: args.insecure,
        json: args.json,
        filters: { sites: args.site, collectors: args.collector },
        render: { caps, showUrls: args['show-urls'] },
        historyLimit: history,
        out: line => process.stdout.write(`${line}\n`),
        status: (state, detail) => {
            if (state === 'live')
                everConnected = true;
            process.stderr.write(detail ? `fluidity-tui: ${state} (${detail})\n` : `fluidity-tui: ${state}\n`);
            if (state === 'reconnecting' && !everConnected) {
                handle.stop();
                unreachable();
            }
        },
        onMalformed: total => process.stderr.write(`fluidity-tui: malformed SSE payload dropped (total ${total})\n`)
    });
    const quit = () => {
        handle.stop();
        process.exit(0);
    };
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
};
main();
//# sourceMappingURL=app.js.map