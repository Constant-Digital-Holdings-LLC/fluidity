# Fluidity — project guide

Real-time serial data aggregator. Four components in one monorepo:
**Agent** (`service/src/agent`) reads serial devices via plugins and POSTs
packets over HTTPS · **Web Service** (`service/src/server`) keeps a FIFO and
broadcasts via SSE · **Dashboard** (`client/src/public`) and **TUI** (`tui/src`)
render. Core design rule: plugins *suggest* (`fieldType`, `suggestStyle` on
each `FluidityPacket`), the server relays without interpreting, each client
decides presentation (CSS vs ANSI). Don't move rendering decisions serverward.

## Commands

- `npm run build` — `tsc --build` all projects (client → sims/service/tui)
- `npm test` — build + node:test suite (no hardware/network needed)
- `npm run test:coverage` — c8 with the thresholds CI enforces
- `npm run lint` — ESLint flat config (`eslint.config.js`), all projects
- `npm run dev:server` / `dev:agent` — tsc watch + nodemon

## Conventions and gotchas

- **`dist/` is committed by design.** Configs, EJS views, and TLS certs live
  under `service/dist/{agent,server}/`; build output belongs in commits.
  Never clean `dist` carelessly — it holds runtime config.
- **Tests run with cwd `service/dist/agent`** (see the `test` script): agent
  modules load conf at module top-level from `./conf/` relative to cwd.
  The server side is DI'd (`makeApp(conf)` in `server/modules/expressApp.ts`)
  and doesn't care about cwd.
- Import aliases (root `package.json` `imports`): `#@shared/*` →
  `client/dist/public/shared/*`, `#@sims/*`, `#@client/*`. Shared types:
  `client/src/public/shared/types.ts` (`FluidityPacket`).
- **Simulated devices**: collector `path` `sim://srs` or `sim://generic`
  runs a SerialPortMock fed by `sims/src/srsModel.ts` — protocol per SRS
  C22A spec (PDFs in `tmp/`, untracked), behavior tuned to a production
  capture saved at `sims/fixtures/fy-io-fifo-capture-2026-06-11.json`
  (golden test data — `goldenCapture.test.ts` pins the decoder to it).
- **srsSerial suppression**: messages decoding to nothing but states in
  `extendedOptions.suppress` (default `["COR", "CLEAR"]` — CLEAR is the
  synthetic state for all-zero release frames) are dropped at the agent.
  Tests that verify decode parity opt out with `suppress: []`. The frame
  parser (`parseSrsFrame`) is strict per the C22A docs: single-space hex,
  matched brackets, length-validated (bit-7 extended frames tolerated);
  rejected lines are counted in `collector.dropCounts`.
- TUI has **zero runtime deps** (hand-rolled SSE client, ANSI, key parsing);
  keep it that way. Pure parts (`uiModel`, `composeFrame`, `renderLine`) are
  unit-tested; only thin orchestrators touch the terminal/process.
- `node --test` needs a glob (`"tests/*.test.js"`); a bare directory fails
  on current Node.
- Untrusted serial data: client renderers must sanitize control characters
  (see `tui/src/modules/renderLine.ts`) — terminal escape injection is real.
- Tracking docs: `PLAN.md` (work log + deferred items), `tui/SPEC.md`
  (TUI design; T3 standalone executables still pending).
