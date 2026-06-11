# Fluidity Improvement Plan

Three phases, in order: software device simulators → test coverage → dependency
modernization. Each phase gates the next.

---

## Phase 1 — Software serial simulators (replace Arduino hardware) ✅ DONE

> Completed 2026-06-11. Implementation notes:
> - `sims/` is a composite TS project (`sims/src` → `sims/dist`), aliased as
>   `#@sims/*` in root package.json; referenced by `service/tsconfig.json`.
> - `SerialPortMock` ships inside serialport 10.5 — no new deps were needed.
> - `openPort()` seam added to `SerialCollector`; `sim://srs` and
>   `sim://generic` paths resolve to simulator profiles.
> - Test runner: `npm test` = build + `node --test` over compiled
>   `service/dist/agent/tests/*.test.js` (cwd `service/dist/agent`, dev conf —
>   the cwd dependency goes away with the phase-2 DI refactor).
> - 6 tests passing. End-to-end smoke verified: sim agent → server → /FIFO
>   returns decoded SRS + generic packets.
> - `.ino` sketches moved to `sims/arduino/`.
>
> **Sim v2 (same day):** replaced the static SRS frame table with a stateful
> controller model (`sims/src/srsModel.ts`), built from two evidence sources:
> the SRS Command List 0152 PDF (command C22A documents both telemetry frame
> formats: state-change + 100s heartbeat) and a live capture from f-y.io
> (300-packet FIFO + SSE sample, saved as
> `sims/fixtures/fy-io-fifo-capture-2026-06-11.json` for phase-2 golden
> tests). The model emits virtual-time `TimedLine` events — tests consume
> them directly with zero timers; the feeder schedules them in real time.
> Modeled: QSO overs alternating single-port COR with release-to-zero frames,
> occasional RCVACT co-occurrence, constant per-site port-state signature
> (LINK ⊆ INTERFACED) on a 100s heartbeat, no boot banner.
> `sims/arduino/srs-serial.ino` rewritten to the same model (millis()
> scheduler) for real hardware. 9 tests passing.
> Known gap (deliberate): DTMF `>p:c<` streaming (C22A bit 2) is not
> simulated because the srsSerial plugin can't parse it yet — candidate
> plugin enhancement.

**Goal:** the data currently produced by `sims/*.ino` on real hardware is
producible in-process and on-demand, with no Arduino or SRS controller needed.

### 1.1 Simulator library (`sims/src/`)

New TypeScript package in the existing `sims/` directory (the `.ino` sketches
move to `sims/arduino/` and stay as reference for hardware testing).

- `sims/src/data/srsFrames.ts` — port the SRS frame set from
  `srs-serial.ino`: radio-state frames (`[80 00 00 00 00]\r\n` …) and
  port-state frames (`{d7 81 00 00 00 ff}\r\n` …). Export both the fixed
  frame list and a generator that yields frames.
- `sims/src/data/genericLines.ts` — port the packet-radio/console/NMEA line
  set from `generic-serial.ino`.
- Generators take a **seedable PRNG and injectable delay schedule** so tests
  are deterministic (fixed seed → fixed sequence, zero delay) while the CLI
  mode keeps the random 250ms–10s cadence of the original sketches.

### 1.2 In-process virtual serial port (the test path)

Use serialport's official mock: `@serialport/binding-mock` +
`@serialport/stream`. Tests create a mock port, the simulator writes frames
into it, and the collector reads them exactly as it would from hardware.

Requires one small seam in the agent: `SerialCollector`'s constructor
(`service/src/agent/modules/collectors.ts:344`) currently hardcodes
`new SerialPort({path, baudRate})`. Extract a protected `openPort()` method
(or accept an optional port factory in params) so tests can substitute a
MockBinding-backed stream. Production behavior unchanged.

### 1.3 In-agent simulation (the interactive dev path) — pure Node

No PTYs, no socat, no native deps. The `openPort()` seam from 1.2 does double
duty: when a collector's configured `path` uses a sim scheme (e.g.
`"path": "sim://srs"` or `"sim://generic"`), `openPort()` returns a
MockBinding-backed stream fed by the matching simulator from 1.1 (random
cadence mode), instead of opening a real device.

Manual dev workflow becomes: point a collector at `sim://srs` in
`dev_conf.json`, run `npm run dev:agent`, watch fake SRS data flow to the
dashboard. Works on any OS, no second process to manage. A sample sim-backed
`dev_conf.json` stanza is added to the README/docs.

### 1.4 Proof of life

- Minimal test runner wired up (see phase 2 choice — installed here, expanded
  later) with **one test**: SRS simulator frames → MockBinding port →
  `SRSserialCollector` → assert the decoded `FormattedData` (e.g. `80` in
  position 0 decodes to `COR` on the expected ports).
- `npm test` runs green in CI-like conditions (no hardware, no network).

**Exit criteria:** agent can be fed simulated SRS and generic data entirely in
software; one end-to-end-ish collector test passes; `.ino` files preserved.

---

## Phase 2 — Test coverage ✅ DONE

> Completed 2026-06-11. 33 tests passing, 83.8% line coverage overall
> (`npm run test:coverage`). Implementation notes:
> - Server DI: `makeController(conf, log)`, `makeRouter(conf, controller)`,
>   and `makeApp(conf)` (`server/modules/expressApp.ts`, module-anchored
>   views/static paths). `app.ts` is just the composition root + TLS listen.
> - All four §2.3 bugs fixed with regression tests (the fixes landed with
>   the refactor; the tests verify them): missing-key requests no longer
>   sent, all 2xx accepted, invalid POST gets a 400, `toArray()` copies.
>   Bonus: previously-unmatched socket errors (e.g. ETIMEDOUT) used to leave
>   the post promise pending forever — now they reject; promise rejections
>   are `Error`s, not strings. `PollingCollector` gained `stop()`.
> - Integration: server tested over plain HTTP via `makeApp` (incl. SSE
>   delivery and FIFO eviction); agent pipeline tested against a local
>   HTTPS target using the repo dev certs (sim frame → wire packet).
> - Coverage gaps (accepted): hamLive/vRep plugins (network/trivial),
>   logger/config internals, `client/ui.ts` (DOM; needs jsdom — deferred).
> - Tests still run with cwd `service/dist/agent` because agent modules
>   load conf at module top-level; full conf DI for the agent deferred to
>   phase 3 (it will churn with the dep work anyway).

**Goal:** the behavior that matters is locked down so phase 3 upgrades can be
done with confidence.

### 2.0 Test runner choice

**Recommendation: `node:test`** (built into Node 18+) + `c8` for coverage.
Rationale: zero new dependencies that could constrain or conflict with the
phase-3 upgrade, and tests compile through the same strict `tsc` pipeline as
the code. (Alternative: vitest, nicer DX, but it drags in a toolchain right
before we churn the toolchain.)

### 2.1 Pure-logic tests first (no refactor needed)

- `SRSserialCollector.decode`/`format` — bit-decode matrix, portmap lookup,
  malformed/garbage frames return null (drive with simulator data from 1.1).
- `FormatHelper` — element typing (string/link/date), style codes, `done`
  reset semantics.
- `PacketFIFO` — max-size eviction, seq assignment.
- Type guards in `client/src/public/shared/types.ts` — accept/reject cases.

### 2.2 Testability refactor (incremental, as tests demand)

The blockers: top-level `await confFromFS()` in nearly every module, and
module-level singletons (`sse`, `fifo` in `controller.ts`). Approach:

- Pass `conf` (and logger) into constructors/factory functions; keep
  module-top-level loading only in the `app.ts` composition roots.
- Convert `controller.ts` to a factory: `makeController(conf, fifo, sse)`.
- No framework, no big-bang rewrite — refactor each module when its test is
  written.

### 2.3 Known bugs, fixed test-first

Write the failing test, then fix:

1. `collectors.ts:136-145` — `reject()` without `return`: request is still
   sent with a missing/invalid API key.
2. `collectors.ts:168` — `statusCode / 2 === 100` accepts only exactly 200;
   201/204 wrongly treated as errors.
3. `controller.ts:28-33` — invalid/empty POST body never gets a response
   (agent hangs until timeout). Should 400.
4. `PacketFIFO.toArray()` returns the internal buffer by reference.

### 2.4 Integration tests

- **Server:** `supertest` against the Express app — POST `/FIFO` happy path,
  bad key (401), malformed packet (400), GET `/FIFO` returns history, SSE
  endpoint streams a pushed packet.
- **Agent pipeline:** simulator → MockBinding → collector → intercepted HTTPS
  POST (stub `https.request` or point at an in-test server) → assert the
  `FluidityPacket` on the wire.
- **Smoke (optional, valuable):** sim → real agent process → real server
  process → SSE client receives the packet. This is the hardware-free rig the
  Arduino used to provide.

### 2.5 Coverage reporting

`c8` wired into `npm test`; aim for high coverage on `service/src/**` and
`shared/`, best-effort on DOM-heavy `client/src/public/modules/ui.ts`
(jsdom later if wanted — not a gate).

**Exit criteria:** core logic + server routes + agent pipeline covered; known
bugs fixed; `npm test` is the regression gate for phase 3.

---

## Phase 3 — Dependency modernization ✅ DONE

> Completed 2026-06-11. `npm audit`: 0 vulnerabilities (was 15 incl. 1
> critical). 33 tests green throughout; live e2e smoke verified on the new
> stack. Implementation notes:
> - Toolchain: TypeScript 5.9 (`module: NodeNext` now required and set in
>   all three tsconfigs; client lib → ES2022), ESLint 9 flat config
>   (`eslint.config.js`, typescript-eslint v8 + prettier 3; the deprecated
>   standard-with-typescript stack was installed but never actually
>   extended — dropped without behavior change), `npm run lint` added and
>   clean, @types/node 24, `engines: node >=20`.
> - Runtime: serialport 13 (SerialPortMock unchanged), express 5 +
>   @types/express 5, ejs 6, stack-trace 1.0.0, throttled-queue 3 (proper
>   ESM — the `@ts-ignore` interop hack is gone; new options-object API).
> - Replaced with in-repo code: `express-sse-ts` (abandoned 2022) →
>   `server/modules/sse.ts`; `@vpriem/express-api-key-auth` (bundled
>   express-4 typings clash with express 5) → ~10-line middleware in
>   routes.ts. Removed unused deps: `yaml`, `set-interval-async`,
>   `@types/serialport`, `@types/stacktrace-js` (StackTrace browser global
>   now declared locally in logger.ts).
> - Deliberately not taken: TypeScript 6.0 / ESLint 10 (very new; the
>   ecosystem plugins lag), @types/node 25 (24 = LTS), `es-module-shims`
>   (browser asset is a committed copy under client/dist/public/external —
>   upgrading means re-vendoring, separate task).

### 3.1 Toolchain (no runtime risk)

- TypeScript 4.9 → 5.x (likely revisit `module`/`moduleResolution`; may
  eliminate the `throttled-queue` `@ts-ignore` interop hack at
  `collectors.ts:118-124`).
- Node: pin engines to an active LTS (18 is EOL); update `@types/node`.
- ESLint 8 → 9 flat config + `typescript-eslint` v8; replace the deprecated
  `eslint-config-standard-with-typescript`. Prettier 2 → 3.

### 3.2 Runtime deps, one at a time, suite green between each

- `serialport` 10 → current (verify MockBinding API against 1.2 seam).
- `express` 4 → 5 (breaking: router/error-handling changes; `@types/express`
  to v5).
- `express-sse-ts` — check maintenance status; if abandoned, hand-roll SSE
  (it's ~50 lines) instead of upgrading around it.
- Remaining: `ejs`, `yaml`, `set-interval-async`, `throttled-queue`,
  `@vpriem/express-api-key-auth` (same maintenance check).

### 3.3 Cleanup enabled by the above

- Drop the `@ts-ignore` interop workarounds if 3.1 fixed them.
- `npm audit` clean.

**Exit criteria:** all deps current or consciously replaced; suite green;
no `@ts-ignore` interop hacks left.

---

## Post-plan hardening (2026-06-11, after phase 3)

> Coverage-gap closure pass. 55 tests passing; coverage now honestly measured
> with `c8 --all` (counts unloaded files too): 83.2% lines / 78.7% branches,
> gated in CI at 80/80/75/80.
> - Golden replay test: all 298 captured production frames decode
>   byte-identically to f-y.io's production output
>   (`tests/goldenCapture.test.ts`).
> - `hamLive` tested against synthetic nets + a real captured API response
>   (`sims/fixtures/ham-live-livenets-2026-06-11.json`); `vRep` smoke-tested.
> - Agent misconfiguration: `buildCollectors()` extracted from agent
>   `app.ts` into `modules/runner.ts`; 8 tests cover bad site/targets/
>   collectors/plugin-name. `SerialCollector` gained `stop()` (closes port,
>   which stops the sim feeder).
> - CI: `.github/workflows/ci.yml` — lint + coverage-gated tests on
>   Node 20 and 24.
> - Client UI tested under jsdom (`tests/ui.test.ts`): rendering, seq
>   demarcation, filter render/click/clear/intersection. Enablers: `ui.ts`
>   conf load is now `inBrowser()`-guarded, `#@client/*` alias, DOM lib
>   added to service tsconfig, jsdom `innerText`/`scrollIntoView` shims.
> - `--all` exposed and removed three stale committed dist artifacts with no
>   source (`heartbeat.js`, `fifoController.js`, `packetBuffer.js`).
> - Remaining accepted gaps: both `app.ts` entry composition roots, client
>   `index.ts` (SSE wiring), `genApiKey` bin, logger location-tracing paths,
>   config.ts error branches.

## TUI client (spec: tui/SPEC.md)

> Milestones: T1 stream mode ✅ → T2 interactive ✅ → T3 standalone
> binaries ✅ (all 2026-06-11).
>
> **T3 done.** `npm run build:tui-sea` (tui/scripts/build-sea.mjs): esbuild
> CJS bundle → SEA blob → postject injection into the node binary, with a
> --version smoke test; verified linux-x64 binary (~124MB) streamed live
> data with no Node installed. Release workflow (release.yml) builds five
> targets on v* tags and attaches binaries. Process documented from the
> verified steps in tui/BUILD.md.
>
> **T2 done.** Alt-screen interactive mode (default on a TTY): scrollback
> viewport with ANSI-aware clipping, full-width bottom pane listing
> reporting sites/collectors with live counts, number-key filter toggles
> (Tab switches group, x clears), j/k/arrows/PgUp/PgDn/g/G scrolling with
> auto-scroll pinning, space pause with buffered count, ? help overlay,
> 50ms repaint batching, crash-safe terminal restore. Pure
> composeFrame/reducer model unit-tested (6 more tests, 81 total);
> verified live in a pty against the dev stack. `/` search deferred.
>
> **T1 done.** `tui/` composite project, zero runtime deps. Modules: caps
> (four-tier ladder), theme (CSS-parity palette + hexTo256), renderLine
> (chrome parity, trim convention, OSC 8 links, control-char sanitization —
> untrusted serial data can't inject escapes into the terminal), filters
> (web OR/AND semantics), transport (node:https history+SSE follow with
> backoff reconnect and seq+ts dedupe across server restarts, loopback TLS
> auto-relaxation), stream mode with --json NDJSON. CLI per spec §6 incl.
> localhost default and exit-code 2. 20 TUI tests in the main suite (75
> total), incl. golden-capture rendering at all four tiers and a live
> reconnect-after-restart transport test. Verified live against the dev
> server + sim agent. Coverage gate adjusted to 78 lines (entry points
> uncovered by design).

## Deferred / known hazards (not in scope, tracked so they're not forgotten)

- **`dist/` layout:** configs, EJS views, and TLS certs live under
  `service/dist/`, and the service imports shared code from `client/dist/`.
  A `clean` deletes production config. Worth restructuring eventually;
  touching it mid-plan would churn every phase.
- Client `FilterManager` encodes state in DOM id strings — less fragile
  than first assessed (ids with spaces round-trip fine, verified by the
  jsdom tests, which now provide a safety net for any refactor).
- srsSerial DTMF telemetry (`>p:c<`, C22A bit 2) — plugin can't parse it;
  sim support would follow the plugin.
- TUI `/` incremental search (deferred from T2).
