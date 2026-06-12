#!/usr/bin/env node
//Colorbar: the visible palette test pattern. Builds one FluidityPacket whose
//fields exercise every suggestStyle 0..10 and POSTs it to a Fluidity server,
//so all eleven packet colors render at once in the web dashboard and the TUI -
//the SMPTE color-bars idea, on the live stream.
//
//  npm run colorbar                       (-> the dev server, key from dev_conf)
//  npm run colorbar -- --target https://host/FIFO --key <apikey> --site BARS
//
//colorBarPacket() is the single source the suite's colorbar tests render too.

import https from 'node:https';
import { readFileSync } from 'node:fs';
import { FluidityPacket } from '#@shared/types.js';
import { isMain, arg } from '#@sims/cliArgs.js';

//labels double as the legend so the bar is self-describing on screen
export const COLORBAR_STYLES: readonly { style: number; name: string }[] = [
    { style: 0, name: 'light' },
    { style: 1, name: 'mauve' },
    { style: 2, name: 'periwinkle' },
    { style: 3, name: 'blue' },
    { style: 4, name: 'cyan' },
    { style: 5, name: 'mauve2' },
    { style: 6, name: 'pink' },
    { style: 7, name: 'gray' },
    { style: 8, name: 'tan' },
    { style: 9, name: 'peach' },
    { style: 10, name: 'taupe' }
];

export const colorBarPacket = (site = 'COLORBAR'): FluidityPacket => ({
    site,
    plugin: 'colorbar',
    ts: new Date().toISOString(),
    description: 'palette test pattern',
    formattedData: COLORBAR_STYLES.map(({ style, name }) => ({
        suggestStyle: style,
        field: `${style}:${name}`,
        fieldType: 'STRING'
    }))
});

if (isMain(import.meta.url)) {
    let target = arg('target');
    let key = arg('key');

    //default to the dev server: read the first target from the agent dev conf
    if (!target || !key) {
        try {
            const conf = JSON.parse(readFileSync('service/dist/agent/conf/dev_conf.json', 'utf8')) as {
                targets?: { location?: string; key?: string }[];
            };
            target = target ?? conf.targets?.[0]?.location;
            key = key ?? conf.targets?.[0]?.key;
        } catch {
            //no readable dev conf - flags are required
        }
    }

    if (!target || !key) {
        console.error(
            'colorbar: need --target <url> --key <apikey> (or a readable service/dist/agent/conf/dev_conf.json)'
        );
        process.exit(2);
    }

    const body = JSON.stringify(colorBarPacket(arg('site') ?? 'COLORBAR'));
    const u = new URL(target);
    //same policy as the agent and the TUI: the self-signed-dev-cert
    //exemption applies to loopback only - a remote --target is verified
    //unless --insecure is passed explicitly
    const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']).has(u.hostname);
    const insecure = process.argv.includes('--insecure');
    const req = https.request(
        {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            method: 'POST',
            rejectUnauthorized: !(loopback || insecure),
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': key,
                'Content-Length': Buffer.byteLength(body)
            }
        },
        res => {
            const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
            console.log(`colorbar -> ${target} : ${res.statusCode}${ok ? ' (watch the web UI / TUI)' : ''}`);
            process.exit(ok ? 0 : 1);
        }
    );
    req.on('error', e => {
        console.error(`colorbar: ${e.message}`);
        process.exit(1);
    });
    req.write(body);
    req.end();
}
