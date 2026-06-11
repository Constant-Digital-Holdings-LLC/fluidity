// Builds a standalone fluidity-tui executable via Node SEA.
// Run from the repo root AFTER `npm run build`:  node tui/scripts/build-sea.mjs
// Verified steps are documented in tui/BUILD.md; CI (release.yml) runs this
// same script on every release platform.

import { build } from 'esbuild';
import { inject } from 'postject';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

//fileURLToPath, not URL.pathname: the latter yields "/D:/..." on Windows
const root = fileURLToPath(new URL('../..', import.meta.url));
const outDir = join(root, 'tui', 'build');
mkdirSync(outDir, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const isWindows = process.platform === 'win32';
const exeName = isWindows ? 'fluidity-tui.exe' : 'fluidity-tui';
const exePath = join(outDir, exeName);

// 1. bundle the compiled TUI (ESM, #@ aliases) into a single CJS file
console.log('[1/4] esbuild bundle');
await build({
    entryPoints: [join(root, 'tui', 'dist', 'app.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: join(outDir, 'bundle.cjs'),
    define: { 'process.env.FLUIDITY_TUI_VERSION': JSON.stringify(pkg.version) },
    logLevel: 'warning'
});

// 2. SEA preparation blob
console.log('[2/4] SEA blob');
const seaConfig = join(outDir, 'sea-config.json');
writeFileSync(
    seaConfig,
    JSON.stringify({
        main: join(outDir, 'bundle.cjs'),
        output: join(outDir, 'sea-prep.blob'),
        disableExperimentalSEAWarning: true
    })
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 3. copy the node binary and inject the blob
console.log('[3/4] inject into node binary');
//unlink first: overwriting an executable that's currently running fails with
//ETXTBSY on linux; removing the directory entry is safe (the running process
//keeps its inode) and a fresh file is written in its place
rmSync(exePath, { force: true });
copyFileSync(process.execPath, exePath);
chmodSync(exePath, 0o755);

if (process.platform === 'darwin') {
    // the signature must be removed before injection and re-applied after
    execFileSync('codesign', ['--remove-signature', exePath]);
}

await inject(exePath, 'NODE_SEA_BLOB', readFileSync(join(outDir, 'sea-prep.blob')), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {})
});

if (process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', exePath]); // ad-hoc signature
}

// 4. smoke test
console.log('[4/4] smoke test');
const version = execFileSync(exePath, ['--version'], { encoding: 'utf8' }).trim();
if (!version.includes(pkg.version)) {
    throw new Error(`smoke test failed: got "${version}", expected version ${pkg.version}`);
}

console.log(`OK: ${exePath} (${version}, ${process.platform}-${process.arch})`);
