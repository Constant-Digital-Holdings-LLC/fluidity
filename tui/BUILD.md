# Building a standalone fluidity-tui executable

`fluidity-tui` can be packaged as a single self-contained binary — no Node
installation needed on the target machine — using Node's Single Executable
Application (SEA) support. The TUI has zero runtime npm dependencies and no
native modules, which is what makes this clean.

These steps are verified on linux-x64; CI runs the **same script** on every
release platform (see `.github/workflows/release.yml`), so if you change the
process, change both this document and that workflow.

## TL;DR

```sh
npm install          # once
npm run build:tui-sea
./tui/build/fluidity-tui --version
```

The binary lands at `tui/build/fluidity-tui` (`.exe` on Windows), is about
**~120 MB** (it embeds the Node runtime), and is specific to the OS/arch it
was built on — SEA does not cross-compile. Build on the platform you target.

## What the script does

`tui/scripts/build-sea.mjs`, step by step:

1. **Bundle** — esbuild flattens the compiled TUI (`tui/dist/app.js`, ESM
   with `#@shared`/`#@sims` import aliases) into one CommonJS file,
   `tui/build/bundle.cjs`. SEA requires CJS; this is why the TUI's own code
   avoids top-level await, and why `--version` falls back to a constant the
   bundler defines (`import.meta.url` doesn't survive CJS bundling).
2. **Blob** — `node --experimental-sea-config` turns the bundle into a SEA
   preparation blob per `sea-config.json` (generated into `tui/build/`).
3. **Inject** — the running `node` binary is copied to
   `tui/build/fluidity-tui` and the blob is injected into it with postject
   under the `NODE_SEA_BLOB` resource (standard sentinel fuse). On macOS the
   existing code signature is removed first and an ad-hoc signature applied
   after; on Linux, postject prints benign `.note` section warnings.
4. **Smoke test** — the produced binary must report the right `--version`
   or the build fails.

## Platform notes

| platform | notes |
|---|---|
| linux-x64 / linux-arm64 | works as-is; arm64 release builds run on GitHub's arm runners |
| macOS (both arches) | `codesign` steps are handled by the script (ad-hoc signature); distributing outside your machine may warrant a real signing identity |
| Windows | builds `fluidity-tui.exe`; signing (signtool) is not automated |
| 32-bit ARM (older Raspberry Pi OS) | not covered by SEA — official Node binaries don't exist for armv7. Install an armv7 Node ≥ 20 (e.g. via nvm or unofficial-builds) and use `npx fluidity-tui` instead |

## Releases

Pushing a tag matching `v*` triggers `.github/workflows/release.yml`, which
runs the test suite and this build on all five targets (linux x64/arm64,
macOS x64/arm64, Windows x64) and attaches the binaries to the GitHub
release.
