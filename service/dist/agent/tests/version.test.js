import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
void test('served appVersion matches the package.json version', async () => {
    const pkgPath = fileURLToPath(new URL('../../../../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const conf = await confFromFS();
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(conf.appVersion, pkg.version);
    assert.equal(conf.appName, 'Fluidity');
});
