# Fluidity TUI — Specification

Status: **living document — T1 (stream), T2 (interactive), and T3
(standalone executables) all shipped 2026-06-11** (see Milestones)

A terminal client for Fluidity. Connects to an existing Fluidity web service
over HTTPS, renders the live packet stream in the terminal, and ships both as
an npm bin (`npx fluidity-tui`) and as standalone single-file executables.

This is the second interpreter of the FluidityPacket contract: the agent's
plugins *suggest* (fieldType + suggestStyle), the server relays, and clients
decide presentation. The TUI must make its own rendering decisions from the
same suggestions the web dashboard uses — never from new server-side fields.

---

## 1. Goals / non-goals

**Goals**

- First-class experience on: Linux (modern terminal emulators), macOS
  (Terminal.app, iTerm2), Windows 10+ (Windows Terminal, conhost with VT),
  and **Raspberry Pi OS text console** (`TERM=linux`, no X).
- Visual parity with the web dashboard where the terminal allows; graceful,
  *designed* degradation where it doesn't (not accidental degradation).
- Zero runtime npm dependencies (transport, ANSI, input all hand-rolled —
  consistent with the repo's direction; Node ≥ 20 built-ins only).
- Pipe-safe: output is clean plain text when stdout is not a TTY.
- Standalone executables via Node SEA for releases.

**Non-goals**

- Serial collection (the TUI is a client; the agent already owns devices).
- Replacing the web dashboard. Feature subset is fine.
- Windows 8/conhost-legacy, armv6/armv7 (32-bit Pi OS) — out of scope; the
  Pi target is 64-bit Raspberry Pi OS (Pi 3 and later).
- Mouse support (keyboard-first; mouse may come later).

---

## 2. Placement in the monorepo

```
tui/
  SPEC.md            (this document)
  tsconfig.json      composite project, same strict settings as sims/
  src/
    app.ts           entry point / CLI parsing / mode selection
    modules/
      transport.ts   /FIFO fetch + /SSE stream + reconnect/merge
      caps.ts        terminal capability detection
      theme.ts       suggestStyle -> color, per capability tier
      renderLine.ts  packet -> parts/styled line (shared by both modes)
      stream.ts      follow/pipe mode
      uiModel.ts     interactive state + key reducer (pure)
      screen.ts      frame composition (pure) + terminal control
      interactive.ts interactive orchestrator (transport/input/repaint)
      keys.ts        raw-mode keyboard parsing
      ansiText.ts    ANSI-aware measurement/truncation
      filters.ts     site/collector filter logic (web semantics)
    tests/           runs inside the main npm test suite
```

- Root `package.json`: add `"#@tui/*": "./tui/dist/*"` import alias, a
  `"bin": { "fluidity-tui": "tui/dist/app.js" }` entry, and
  `dev:tui` / `build` wiring (service tsconfig references `../tui` or the
  build script grows a second `tsc --build tui/tsconfig.json`).
- Reuses `#@shared` types (`FluidityPacket`, guards) and nothing DOM-bound.
- Tests live in `service/src/agent/tests/` convention or `tui/src/**.test.ts`
  compiled like the rest — final location decided at implementation; they run
  under the existing `npm test` glob either way.

---

## 3. Packet interpretation contract (normative)

The TUI renders a packet as one logical line:

```
[HH:MM:SS] site(description): field field field…
```

- `fieldType: 'STRING'` → text styled per `suggestStyle`.
- `fieldType: 'DATE'` → parsed ISO timestamp rendered in **local time**,
  `HH:MM` (mirrors web client).
- `fieldType: 'LINK'` → `field.name` rendered as a link: OSC 8 hyperlink
  where supported; otherwise underlined name. `--show-urls` appends the URL
  in parentheses for terminals/users that can't follow OSC 8.
- `suggestStyle >= 100` → the web client's trim convention: color
  `style % 10`, no leading/trailing spacing. The TUI renders these with no
  inter-field gap (web equivalent of `fp-trim`).
- Unknown future `fieldType` → render `JSON.stringify(field)` plain (web
  parity: default branch).
- Packet chrome (brackets, site, description, colon) gets fixed theme roles,
  not suggestStyle (web parity: `.bracket-open`, `.site`, `.description`).

---

## 4. Visual design

### 4.1 Color tiers and the palette

Capability ladder (highest wins):

| Tier | Detection | Notes |
|---|---|---|
| truecolor | `COLORTERM=truecolor\|24bit`, Windows Terminal (`WT_SESSION`), iTerm | exact web parity |
| 256 | `TERM` contains `256color` | nearest-color quantization of the truecolor palette |
| 16 | `TERM=linux` (Pi console), plain `xterm`, conhost | hand-picked ANSI mapping below |
| mono | `NO_COLOR`, `--color=never`, dumb terminal, non-TTY | bold/underline only |

`suggestStyle` palette — truecolor values come straight from
`client/dist/public/css/fluidity.css`; the 16-color column is a deliberate
artistic mapping (not a naive quantization), tuned for the Linux console's
default palette on a dark background:

| style | web CSS | truecolor | 16-color ANSI | attrs |
|---|---|---|---|---|
| 0 | `--light` | `#ffe5ff` | white (97) | |
| 1 | `--color1` | `#53354a` | magenta (35) | dim |
| 2 | `--color2` | `#706c9d` | blue (34) | |
| 3 | `--color3` | `#54b0ed` | bright blue (94) | **bold** (web uses `bolder`) |
| 4 | `--color4` | `#00fdff` | bright cyan (96) | |
| 5 | `--color5` | `#472e40` | magenta (35) | dim |
| 6 | `--color6` | `#fe95c6` | bright magenta (95) | |
| 7 | `--color7` | `#999999` | bright black (90) | |
| 8 | `--color8` | `tan` (#d2b48c) | yellow (33) | |
| 9 | `--color9` | `peachpuff` (#ffdab9) | bright yellow (93) | |
| 10 | `--dark` | `#7d6a5f` | bright black (90) | |

Chrome roles (timestamp, brackets, site, description, separators) get their
own theme entries derived the same way from `fluidity.css`.

The mapping lives in one table in `theme.ts`; tiers are columns of the same
table so styles can never drift apart per tier.

### 4.2 Glyph budget

- **ASCII-first.** All information must survive in pure ASCII.
- Single-line box drawing (`─ │ ┌ ┐ └ ┘`) allowed everywhere *except*
  `TERM=linux`… actually present in the console's CP437-derived fonts, so
  allowed there too — but nothing beyond it: no rounded corners, no braille
  spinners, no powerline glyphs, no emoji, anywhere. The spinner is
  `|/-\`. Decorative quality comes from color and spacing, not glyphs.
- No italics (Linux console can't); emphasis = bold or color.

### 4.3 Stream mode (follow mode) layout

Default when stdout is a pipe, or with `--follow`. One packet per line,
colored when TTY, plain when piped:

```
12:09:14 Verdugo Pk(SRS1): Radio States:  RB-2M Remote Base: COR
12:09:15 Loop Cyn(SRS): Port States:  R0-440: LINK,LOOPBACK,INTERFACED  L1-Verdugo Pk: LINK,INTERFACED
12:09:21 MyOffice(Net Watcher): The Breakfast Club Net  in progress
```

`--json` emits raw FluidityPacket NDJSON instead (scripting/jq).

### 4.4 Interactive mode layout

Default when stdout is a TTY. Alternate screen buffer, restored on exit.

```
┌ Fluidity · f-y.io ──────────────────────────── ● live · 4123 pkts ┐
│ 12:09:14 Verdugo Pk(SRS1): Radio States:  RB-2M: COR              │
│ 12:09:15 Loop Cyn(SRS): Port States:  R0-440: LINK,LOOPBACK,…     │
│ 12:09:21 MyOffice(Net Watcher): Breakfast Club Net  in progress   │
│ …                                                                 │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│ sites: [1]VERDUGO PK 93  [2]LOOP CYN 7  [3]MT WILSON 64  +14 more  │
│ [1-9] toggle  [Tab] collectors  [x] clear(1)  [space] [?] [q]      │
└────────────────────────────────────────────────────────────────────┘
```

- Header: `Fluidity - <server host>` left, connection state + packet count
  right (right side wins when width is tight; scroll offset shown as `^N`,
  pause as `PAUSED(+N)`). ASCII state glyphs: `*` live, `~` connecting/
  reconnecting, `o` stopped.
- Body: scrollback viewport (default 4000 packets, `--history` overrides;
  mirrors web `maxClientHistory` default), ANSI-aware line clipping.
  Timestamp/site/description columns align to the widest values seen so
  far (timestamps right-aligned), so fields share a column edge; the whole
  window realigns as new sites appear. Stream/pipe mode stays unpadded.
- Auto-scroll pinned to bottom; scrolling up unpins; `G` (or a filter
  change) re-pins.
- **Bottom pane (full width): who is reporting in.** Lists sites (or
  collectors — Tab switches) in first-seen order with live packet counts,
  each numbered `[1]`-`[9]` for direct filter toggling. Selected entries
  are highlighted (bold/underline brand pink, matching the web's
  "pink = active"; `*`-marked in mono). Each site carries a liveness mark
  (web parity, shape + color so mono still reads): `*` reporting within
  ~2.5 min (brand pink — alive), `~` quiet up to ~7.5 min (peach), `.`
  silent (dim). Overflow shows
  `+N more`. Sites render uppercase (web parity).
- **Header rate strip**: spare header width renders packet rate as a
  CP437-safe shade ramp (`░▒▓█`) in the brand accent — the web sparkline's
  console counterpart. `w` cycles 5m/1h/24h (60 buckets each, accumulating
  in parallel); shared RateBuckets/window logic from the client module.
  Omitted when the terminal is too narrow.
- Hints line: the active keybindings + current filter count.

### 4.5 Keybindings (interactive, as built)

| key | action |
|---|---|
| `q` / `Ctrl-C` | quit (restore screen) |
| `1`–`9` | toggle the filter for the numbered item in the bottom pane |
| `Tab` | switch the bottom pane between sites and collectors |
| `x` | clear all filters |
| `w` | cycle the header rate strip window (5m / 1h / 24h) |
| `space` | pause/resume rendering (stream continues buffering; count shown) |
| `j`/`k`, `↑↓`, `PgUp`/`PgDn` | scroll |
| `g` / `G` | top / bottom (`G` re-enables auto-scroll) |
| `?` | help overlay (any key dismisses) |

Deferred to a follow-up: `/` incremental search with `n`/`N`.

Filter semantics mirror the web client: selected sites OR'd, selected
collectors OR'd, the two groups AND'd (intersection) — same behavior our
jsdom tests pin for `FilterManager`.

---

## 5. Transport

- **History**: `GET /FIFO` on startup → render, remember highest `seq` as
  demarcation (web parity).
- **Live**: `GET /SSE` (`Accept: text/event-stream`) via Node's built-in
  `fetch` streaming. Parser handles `retry:`, `id:`, `data:` lines (the
  reader we built for `routes.test.ts` is the reference implementation).
  Packets with `seq <= demarc` are dropped (duplicate guard, web parity).
- **Reconnect**: exponential backoff 1s → 30s with jitter. The server does
  **not** replay missed events on reconnect (known hand-rolled SSE
  limitation) — so on every reconnect: refetch `/FIFO`, merge by `seq`,
  render only unseen packets. Connection state surfaces in the header.
- **TLS**: `--insecure` skips chain verification (self-signed dev certs),
  mirroring the agent's `NODE_ENV=development` behavior. Never the default.
- Auth: none — `/FIFO` and `/SSE` are public by design.

---

## 6. CLI

```
fluidity-tui [options]

  --server URL        Fluidity service base URL
                      (default: FLUIDITY_SERVER env, else https://localhost:3000)
  --follow            force stream mode even on a TTY
  --json              raw FluidityPacket NDJSON (implies stream mode)
  --site NAME         pre-filter by site (repeatable)
  --collector NAME    pre-filter by collector/plugin (repeatable)
  --history N         max packets kept in memory (default 4000)
  --color MODE        auto | never | 16 | 256 | truecolor (default auto)
  --show-urls         append URLs after link names
  --insecure          accept self-signed/invalid TLS certificates
  --version, --help
```

Server resolution order: `--server` > `FLUIDITY_SERVER` >
`https://localhost:3000` (the dev server default — supports the README's
"everything on one box" getting-started flow).

TLS: verification is relaxed automatically for **loopback hosts only**
(localhost, 127.0.0.1, ::1), with a one-line notice — the dev server ships
self-signed certs, and MITM is not the loopback threat model. Any
non-loopback server verifies the chain unless `--insecure` is explicit.

Env: `FLUIDITY_SERVER`, `NO_COLOR` (forces mono, per no-color.org),
`FORCE_COLOR` (overrides non-TTY detection).

Exit codes: 0 user quit · 1 bad args · 2 cannot reach server at startup
(the error suggests `--server` if the default was used).

---

## 7. Performance budget

- Render batching: coalesce packets arriving within one tick; repaint at
  most every 50ms (Pi console is slow at scrolling; batching matters there
  most). Stream mode writes are line-buffered.
- Memory: bounded by `--history` (default 4000 packets ≈ a few MB).
- Startup to first rendered packet: < 1s on a Pi 3 against a LAN server.
- Interactive repaint: only dirty regions (chrome vs body); body is
  append-mostly — full-screen redraw only on resize/filter change.

---

## 8. Accessibility & robustness

- `NO_COLOR` / `--color=never` / non-TTY → meaningful without any styling.
- All state changes also appear as text (e.g. "paused", "reconnecting"),
  never color-only.
- SIGWINCH handled (resize). Terminal always restored on exit, including on
  crash (process `exit` hook resets alt buffer, cursor, raw mode).
- Malformed SSE payloads are dropped with a status-line note, never a crash
  (`isFfluidityPacket` guard on every packet — same boundary the server
  enforces).

---

## 9. Testing

- **Golden fixture snapshots**: render
  `sims/fixtures/fy-io-fifo-capture-2026-06-11.json` through `renderLine`
  at each color tier (truecolor / 256 / 16 / mono) and snapshot the output.
  The same 298 production packets that pin the agent decoder pin this
  interpreter.
- **Transport tests**: run against the real `makeApp()` server over HTTP
  (existing harness) — history fetch, SSE delivery, seq dedupe, and the
  reconnect+merge path (kill the server, restart, assert no duplicates/no
  gaps).
- **Caps detection**: table-driven tests over env permutations
  (`TERM=linux`, `COLORTERM`, `NO_COLOR`, `WT_SESSION`, non-TTY).
- **Filter logic**: same OR/AND-intersection cases the jsdom suite pins for
  the web client.
- Interactive screen chrome is verified by snapshot of the composed frame
  buffer (no pty needed); raw-mode input handling gets a thin unit test
  over key-sequence parsing (arrows, ctrl keys).
- Manual acceptance matrix before release: Windows Terminal, conhost,
  Terminal.app, iTerm2, gnome-terminal/alacritty, **Pi OS text console**.

---

## 10. Packaging

- **T1/T2 distribution**: `bin` entry → `npx fluidity-tui` / global install.
  Requires Node ≥ 20 (engines already says so).
- **T3 standalone executables** via Node SEA:
  1. `esbuild` bundles `tui/dist/app.js` → single CJS file (TUI code must
     avoid top-level await; transport/theme modules are TLA-free by design).
  2. `node --experimental-sea-config` → blob; `postject` injects into a
     platform Node binary.
  3. CI matrix builds: `linux-x64`, `linux-arm64` (Raspberry Pi OS 64-bit,
     built on GitHub's arm runners), `darwin-x64`, `darwin-arm64`,
     `win32-x64`. Artifacts attached to GitHub releases.
- Known SEA tradeoffs (accepted): ~90–110MB binaries (embedded Node),
  per-platform builds, experimental warning on stderr (suppressed via
  `--disable-warning=ExperimentalWarning` where available).
- The TUI has zero native deps, so SEA bundling stays clean.

---

## 11. Milestones

**T1 — stream mode (MVP)** ✅ shipped 2026-06-11
`tui/` project, transport, caps/theme, `renderLine`, stream + `--json`,
filters via flags, golden snapshots, transport tests. *Accept:* pointed at
f-y.io, colored live stream on all four platforms; piped output is clean
text; suite green in CI.

**T2 — interactive mode** ✅ shipped 2026-06-11
Alt-screen chrome, scrollback, keyboard filters/search/pause, reconnect UX.
*Accept:* the §4.4 layout works on Windows Terminal and the Pi console
(16-color, ASCII-only degradation by design); terminal always restored.

**T3 — standalone executables** ✅ shipped 2026-06-11
SEA pipeline + CI release artifacts for the five targets. *Accept:* a
freshly flashed Pi OS box runs the downloaded binary against a LAN server
with no Node installed.

---

## 12. Resolved decisions (2026-06-11)

1. **Tests: one suite.** TUI tests compile through the same tsc pipeline and
   run inside the existing `npm test` invocation (additional glob); CI gates
   them from T1.
2. **Header: host only.** No new server endpoint; the header identifies the
   instance by server host (e.g. `Fluidity · f-y.io`). The `org` name
   remains a web-dashboard nicety.
3. **armv7 (32-bit Pi OS): documented npx path.** Standalone binaries are
   arm64-only. README/spec note for armv7: install an armv7 Node ≥ 20
   (unofficial-builds/nvm) and run `npx fluidity-tui` — the code itself has
   no architecture constraints.
