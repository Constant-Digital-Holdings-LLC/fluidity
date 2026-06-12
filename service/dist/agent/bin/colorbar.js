#!/usr/bin/env node
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const COLORBAR_STYLES = [
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
export const colorBarPacket = (site = 'COLORBAR') => ({
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
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    const arg = (name) => {
        const i = process.argv.indexOf(`--${name}`);
        return i !== -1 ? process.argv[i + 1] : undefined;
    };
    let target = arg('target');
    let key = arg('key');
    if (!target || !key) {
        try {
            const conf = JSON.parse(readFileSync('service/dist/agent/conf/dev_conf.json', 'utf8'));
            target = target ?? conf.targets?.[0]?.location;
            key = key ?? conf.targets?.[0]?.key;
        }
        catch {
        }
    }
    if (!target || !key) {
        console.error('colorbar: need --target <url> --key <apikey> (or a readable service/dist/agent/conf/dev_conf.json)');
        process.exit(2);
    }
    const body = JSON.stringify(colorBarPacket(arg('site') ?? 'COLORBAR'));
    const u = new URL(target);
    const req = https.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': key,
            'Content-Length': Buffer.byteLength(body)
        }
    }, res => {
        const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
        console.log(`colorbar -> ${target} : ${res.statusCode}${ok ? ' (watch the web UI / TUI)' : ''}`);
        process.exit(ok ? 0 : 1);
    });
    req.on('error', e => {
        console.error(`colorbar: ${e.message}`);
        process.exit(1);
    });
    req.write(body);
    req.end();
}
