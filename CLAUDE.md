# Fluidity — project guide

Real-time serial data aggregator. Five components in one monorepo:
**Agent** (`service/src/agent`) reads serial devices via plugins — and acts as
a UDP forwarding gateway for microcontrollers (`udpStruct` collector, see UDP
ingest below) — and POSTs packets over HTTPS · **Web Service**
(`service/src/server`) keeps a FIFO and broadcasts via SSE · **Dashboard**
(`client/src/public`) and **TUI** (`tui/src`) render · **Watcher**
(`service/src/watcher`) is a standalone SSE subscriber that fires alert
programs on patterns/silence (see Watcher below). Core design rule: plugins
*suggest* (`fieldType`, `suggestStyle` on each `FluidityPacket`), the server
relays without interpreting, each client decides presentation (CSS vs ANSI).
Don't move rendering decisions serverward.

## Commands

- `npm run build` — `tsc --build` all projects (client → sims/service/tui)
- `npm test` — build + node:test suite (no hardware/network needed)
- `npm run test:coverage` — c8 with the thresholds CI enforces
- `npm run lint` — ESLint flat config (`eslint.config.js`), all projects
- `npm run dev:server` / `dev:agent` — tsc watch + nodemon
- `npm run sim:udp` — fire a simulated UDP device fleet at the dev agent's
  `udpStruct` collector on 17996 (`--once` for a single burst)
- `npm run sim:udp-stress` — rate-controlled barrage for load testing
  (`--rate --duration --devices --mix valid:70,garbage:30 --secret --seed`);
  sender-side counts are exact, seeded runs are deterministic
- `npm run loadtest` — full e2e harness (emitter → real udpStruct collector →
  real HTTPS → real `makeApp` server, optional SSE subscribers); prints
  throughput/drops/backpressure/loop-lag/memory. `-- --rate N --duration S
  --mix … --secret <hex> --sse K`. CPU profile: run
  `service/dist/loadtest/cli.js` under `node --cpu-prof`. The same
  `runLoadtest()` core is exercised by `udpEmission.test.ts` in the suite.

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
- **Collector `enabled` flag**: a collector stanza with `"enabled": false`
  stays in config (documented, easy to switch on) but is skipped by
  `buildCollectors` (`modules/runner.ts`); anything other than explicit
  `false` loads. The Net Watcher (`hamLive`) ships disabled by default.
- **UDP ingest** (`service/UDP-SPEC.md`): `udpStruct` collector decodes
  packed flu_packet_v1 datagrams via `modules/udpCodec.ts`.
  `sims/src/udpDeviceSim.ts` is an intentionally independent second
  implementation of the wire format (firmware reference) — tests pin the
  two byte-for-byte; don't "deduplicate" them. Loopback UDP drops part of
  any unpaced burst — tests pace sends and retry sentinels by design.
  Auth (U2): `sims/src/siphash.ts` is the repo's one SipHash-2-4, pinned
  to the 64 official vectors (it lives in sims because service→sims is
  the allowed dependency direction); collector modes open/migration/MAC
  per spec §4 — misconfigured security options throw at startup, never
  warn-and-fallback. Sim signs with `--secret <hex32>`.
- **Firmware kit** (U3): `firmware/fluidity_udp.h` is the C reference —
  a third independent wire implementation (the MicroPython port in
  `sims/micropython/fluidity_udp.py` is a fourth). `udpFirmware.test.ts`
  host-compiles the C (gcc/clang, -Werror) and pins its output byte-for-byte
  against the agent codec and sim packer; `udpMicropython.test.ts` pins the
  Python the same way under `python3`. Both skip cleanly when the toolchain
  is absent. Sketches in `sims/arduino/udp-*` expect the header copied
  beside the .ino (Arduino IDE limitation) — don't commit copies. Dev-facing
  docs (artifact map, security-mode guide, porting table): `firmware/README.md`.
- **srsSerial suppression**: messages decoding to nothing but states in
  `extendedOptions.suppress` (default `["COR", "CLEAR"]` — CLEAR is the
  synthetic state for all-zero release frames) are dropped at the agent.
  Tests that verify decode parity opt out with `suppress: []`. The frame
  parser (`parseSrsFrame`) is strict per the C22A docs: single-space hex,
  matched brackets, length-validated (bit-7 extended frames tolerated);
  rejected lines are counted in `collector.dropCounts`.
- **Log tailing** (L1/L2/L3): `logTail` collector tails a growing file via
  `FileTailCollector` (collectors.ts) — poll-and-read-the-delta (not
  fs.watch), start-at-EOF, rotation/truncation/copytruncate/partial-line/
  stream-UTF-8/BOM handling, fleet throttle default. File identity falls back
  inode→creation-time so it survives Windows/FAT (ino 0); `statFile()` is the
  seam `logTailCrossOS.test.ts` overrides to emulate other OSes' stat quirks
  on Linux CI. The line **tokenizer** (`modules/tokenize.ts`, shared with
  `genericSerial`) suggests `fieldType`/`suggestStyle` per token (clients
  decide CSS/ANSI) — json/logfmt/syslog/levelmsg detectors, http(s)→LINK
  (control-safe), user regex rules, ReDoS-bounded. On by default for
  `logTail`, opt-in (`extendedOptions.tokenize`) for `genericSerial`; a plain
  line still yields one style-0 STRING. Multiline (`extendedOptions` on
  logTail) coalesces stack traces into one packet (joiner defaults `\n`;
  single-line renderers flatten until clients render multi-line).
- **Watcher** (`service/src/watcher`, `npm run start:watcher`): a standalone
  SSE subscriber — NOT server code, by design (a watchdog must outlive what it
  watches, and exec risk stays out of the hardened ingest path). `sseFollow`
  reconciles `/FIFO` + dedups (a service-side reimpl of the TUI transport —
  build order forbids service→tui imports); `PatternMatcher` (pure, clock
  injected) gates `silence` on connection state and judges absence by packet
  `ts`, never local arrival, so a dropped pipe isn't a dead site; `AlertRunner`
  bounds exec (concurrency cap + shed queue + per-rule cooldown/coalesce +
  token bucket + timeout + circuit breaker). **Security:** untrusted packet
  text reaches alert programs only as data (stdin/FLU_* env/argv array,
  `shell:false`) and the child gets a minimal PATH+FLU_* env — the server's
  TLS/API-key env is never inherited; misconfigured rules throw at startup.
  Config under `service/dist/watcher/conf/` (example in `conf-examples/`).
- TUI has **zero runtime deps** (hand-rolled SSE client, ANSI, key parsing);
  keep it that way. Pure parts (`uiModel`, `composeFrame`, `renderLine`) are
  unit-tested; only thin orchestrators touch the terminal/process.
- `node --test` needs a glob (`"tests/*.test.js"`); a bare directory fails
  on current Node.
- Untrusted serial data: client renderers must sanitize control characters
  (see `tui/src/modules/renderLine.ts`) — terminal escape injection is real.
- Tracking docs: `PLAN.md` (work log + deferred items), `tui/SPEC.md`
  (TUI design; all phases incl. T3 standalone executables shipped — the SEA
  release pipeline builds binaries for five targets).
- User-facing docs: `README.md` (overview + doc map), `INSTALL.md` (build/run/
  deploy), `RUNBOOK.md` (operate: collectors, viewing, watcher/alerting,
  troubleshooting). Keep them in sync when behavior or config shape changes —
  the watcher rule schema and `FLU_*`/template tables in RUNBOOK mirror
  `service/src/watcher/rules.ts` and `alertRunner.ts`.
