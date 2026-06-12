# Fluidity Runbook

Operating a Fluidity deployment: choosing and wiring up data sources, viewing
the live stream, and **setting up alerting** — e.g. get a push notification
when a device's heartbeat goes silent or a log starts erroring.

New here? Install and start the stack first: **[INSTALL.md](INSTALL.md)**.

## The pipeline

```
 data sources              Agent                Server              consumers
┌──────────────┐      ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ serial ports │      │  collectors  │     │  FIFO + SSE  │     │  Dashboard   │
│ log files    │ ───▶ │  (1 plugin   │ ──▶ │  relays, never│ ─▶ │  TUI         │
│ UDP / MCUs   │ HTTPS│   per source)│HTTPS│  interprets  │ SSE │  Watcher     │
└──────────────┘      └──────────────┘     └──────────────┘     └──────────────┘
```

The **agent** runs one collector per source and POSTs each reading upstream.
The **server** keeps a bounded FIFO and fans it out over Server-Sent Events.
**Consumers** subscribe: the Dashboard and TUI render; the **Watcher** matches
patterns and fires alert programs. Core rule — a collector only *suggests*
field types and styles; the server relays without interpreting, and each
consumer decides presentation. Don't push rendering or alerting logic into the
server.

---

## Data sources: configuring collectors

Collectors live in the agent config's `collectors: []` array. Each stanza has a
`description`, a `plugin`, and plugin-specific options. Edit
`service/dist/agent/conf/dev_conf.json` (or `prod_conf.json`) and restart the
agent to pick up changes.

**The `enabled` flag.** Set `"enabled": false` to keep a documented stanza in
config but skip it at load — the same convention collectors and watcher rules
share. Anything other than an explicit `false` loads normally.

> ⚠️ A **quoted** `"false"` is truthy and *enables* the collector. The agent
> logs a warning if it sees one — if a stanza you meant to disable is running,
> check for quotes around the value.

### The plugin menu

| Plugin          | Source                                            | Notes                                                            |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `genericSerial` | any serial device / console                       | optional line tokenizer (`extendedOptions.tokenize`)             |
| `srsSerial`     | Sierra Radio Systems controllers (C22A telemetry) | strict frame parsing; `suppress` noise filter                    |
| `logTail`       | a growing log file                                | tokenizer on by default; rotation/truncation safe                |
| `udpStruct`     | microcontrollers over UDP                          | the agent's UDP gateway; optional SipHash auth                   |
| `hamLive`       | ham.live live-nets API                            | the Net Watcher; **disabled by default**                         |

No hardware? Point any serial collector at a **simulator**: `sim://generic`
(assorted console data) or `sim://srs` (SRS controller telemetry). They use the
same parsers and data path as real devices.

> **Liveness heartbeat (internal).** Every agent emits an internal `vRep` report
> on its own — you do **not** configure it (a configured `vRep` stanza is ignored
> with a warning). It reports the agent in every `HEARTBEAT_SEC` (120 s by
> default; override with the top-level `heartbeatSec`), which is what keeps a
> site showing "alive" on the dashboard even when no device data is flowing. The
> dashboard's fresh/recent/stale windows are derived from the same constant, so
> the heartbeat rate and the "looks stale" threshold stay aligned.

### Serial devices

```json
{ "description": "Workshop TNC", "plugin": "genericSerial", "path": "/dev/ttyUSB0", "baudRate": 9600 }
```

`path` is an OS device path — `/dev/tty.usbmodem11201` (macOS),
`/dev/ttyUSB0` (Linux), or `COM4` (Windows). Set
`"extendedOptions": { "tokenize": true }` to colorize recognized line formats
(see [Log files](#log-files) for what the tokenizer detects).

### Log files

Any growing file is a data source:

```json
{
    "description": "System Log",
    "plugin": "logTail",
    "path": "/var/log/syslog",
    "extendedOptions": { "tokenize": true }
}
```

`logTail` starts at end-of-file and tails the delta, surviving the usual
gotchas: log rotation, in-place truncation / copytruncate, partial lines,
multibyte UTF-8 split across reads, and a leading Windows BOM. The shared **line
tokenizer** (on by default for `logTail`) recognizes JSON-lines, logfmt,
syslog, and a universal `LEVEL timestamp message` shape — coloring the level,
promoting timestamps and clickable URLs, dimming `key=value` pairs. A line that
matches nothing renders as its raw text. Multiline coalescing (a stack trace
into one entry) is available via `extendedOptions`. Design notes: `PLAN.md`
(L1/L2/L3).

### UDP / microcontrollers

Microcontrollers (ESP32/M5Stack, Arduino, AVR, ARM) publish a small packed
binary struct over UDP — no TLS, JSON, or HTTP on the device. The agent runs a
`udpStruct` collector that validates, decodes, and forwards upstream:

```json
{
    "description": "LAN Sensors",
    "plugin": "udpStruct",
    "port": 17996,
    "bind": "127.0.0.1",
    "extendedOptions": { "siteFromPacket": true }
}
```

The agent is the single trust boundary: hostile-input validation, optional
**SipHash-2-4 authentication** (open / migration / MAC modes), and bounded
backpressure all live here. With `siteFromPacket`, each device names its own
site and appears as a first-class pill on the dashboard.

- **Wire format & security model:** `service/UDP-SPEC.md`
- **Firmware kit** (C header, Arduino sketches, MicroPython, porting table,
  security-mode decision guide): **[firmware/README.md](firmware/README.md)**

Quick smoke test from any shell (agent listening on 17996):

```sh
HEX=464c5531010000000000000068656c6c6f00000000000000000000006e632d746573740000000000000000006669727374207061636b65740000000001060068692066726f6d206e65746361740000000000000000000000000000000000000000000000000000
printf '%s' "$HEX" | xxd -r -p | nc -u -w1 your-agent-host 17996
```

A site named `hello` appears with the field "hi from netcat".

---

## Viewing the stream

**Dashboard** — open `https://your-server:port`. Click a site or collector pill
to filter; the view is mobile-friendly and renders style suggestions as CSS.

**TUI** — `node tui/dist/app.js your-host:3000` (the server URL is the first
argument; scheme optional, defaults to https; omit it entirely for
localhost:3000). On an interactive terminal: columns auto-align, a bottom pane
lists every reporting site with live counts — `1`–`9` filter by site, `Tab`
switches to collectors, `space` pauses, `?` shows help. When piped or with
`--follow`/`--json` it streams plain lines instead — `--json` emits raw packet
NDJSON for `jq`, `--site`/`--collector` pre-filter, `--color never|16|256|truecolor`
overrides detection. Full design: **[tui/SPEC.md](tui/SPEC.md)**.

---

## Alerting: the Watcher

The **Watcher** is a standalone process that subscribes to a server's stream and
runs a program of your choosing when a pattern fires (a *storm*) or a heartbeat
goes silent (a *dead-man's switch*). First use case: push an
[ntfy](https://ntfy.sh) notification when a device stops reporting.

**Why a separate process, not server code?** A watchdog must outlive what it
watches. An in-server matcher dies with the server — exactly when you most want
the alert. As an independent subscriber it survives the server's death and can
even alert *"the server went dark."* It also keeps the exec/fork-bomb risk out
of the hardened ingest path and preserves the "server relays, never interprets"
rule. It's just another SSE consumer, like the dashboard and TUI. Typically run
it on the same host as the server (so alert scripts and notification egress are
local); run it elsewhere if you specifically want to detect the server going
down.

### Setup

1. Edit `service/dist/watcher/conf/dev_conf.json` (or `prod_conf.json`). Set
   `watch` to your server URL and add rules under `alerts`. A worked example
   ships at `service/dist/watcher/conf/conf-examples/dev_conf.json`.
2. Make sure each rule's `exec` program exists and is executable — the watcher
   verifies this at startup and **refuses to start** if a path is missing or
   not executable (fail loud, never half-armed).
3. Start it:

   ```sh
   npm run start:watcher
   ```

```json
{
    "appName": "Fluidity Watcher",
    "logLevel": "info",
    "watch": "https://localhost:3000",
    "insecure": true,
    "evalIntervalMs": 1000,
    "alerts": [ /* rules — see below */ ]
}
```

`insecure: true` relaxes TLS verification for a self-signed dev server
(loopback hosts skip verification automatically regardless). `evalIntervalMs`
is the silence/coalesce check cadence (default 1000).

### Rule anatomy

```json
{
    "name": "greenhouse-heartbeat",
    "enabled": true,
    "match": { "site": "greenhouse", "plugin": "logTail", "text": "ERROR|CRIT" },
    "trigger": { "type": "silence", "window": "120s" },
    "exec": "/etc/fluidity/alerts/ntfy.sh",
    "args": ["--topic", "alerts"],
    "message": "{{site}} silent for {{silenceSec}}s (last seen {{lastSeen}})",
    "format": "text",
    "cooldown": "10m",
    "maxPerHour": 12,
    "recover": true
}
```

| Field        | Required | Default                                  | Meaning                                                                              |
| ------------ | :------: | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `name`       |    ✓     | —                                        | unique rule id                                                                       |
| `enabled`    |          | `true`                                   | `false` skips the rule at load                                                       |
| `match`      |    ✓     | —                                        | selector — at least one of `site`/`plugin`/`text` (a rule must not match everything) |
| `trigger`    |    ✓     | —                                        | `silence` or `frequency` (below)                                                     |
| `exec`       |    ✓     | —                                        | absolute path to the program to run; checked executable at startup                   |
| `args`       |          | `[]`                                     | static argv passed to the program                                                    |
| `message`    |          | `{{rule}}: {{reason}} {{site}} {{text}}` | template rendered to the program's **stdin**                                         |
| `format`     |          | `"text"`                                 | `"text"` (render `message`) or `"json"` (structured payload on stdin)                |
| `cooldown`   |          | `60s`                                    | minimum gap between firings; suppressed hits coalesce into the next message          |
| `maxPerHour` |          | `12`                                     | per-rule rate ceiling (token bucket)                                                 |
| `recover`    |          | `false`                                  | also fire when a silenced site starts reporting again                                |

**Selector (`match`).** `site` and `plugin` are exact matches; `text` is a
regular expression tested against the packet's joined field text. All fields
present must match (AND). The text regex runs against at most 4000 characters —
a deliberate ReDoS bound, since rules are operator-authored but log lines are
not.

Durations (`window`, `cooldown`) accept `500ms` / `120s` / `10m` / `2h`, or a
bare number meaning milliseconds.

### Triggers

- **`silence`** — `{ "type": "silence", "window": "120s" }` — fire once when no
  matching packet arrives within the window (the heartbeat / dead-man case).
  With `recover: true`, fire again when the source returns. Under-frequency
  monitoring is just `silence` with the window set to the expected cadence.
- **`frequency`** — `{ "type": "frequency", "count": 20, "window": "60s" }` —
  fire once when matching packets in the rolling window cross `count` (the storm
  case), then re-arm after the window drains.

Silence is judged against each packet's own timestamp (`ts`), not local arrival
time, and is **suspended while the watcher is disconnected** — a dropped
connection is never mistaken for a dead site. On (re)connect the watcher
reconciles last-seen from the server's `/FIFO` snapshot, so a brief blip doesn't
false-fire.

> **Point a `silence` rule at a single site.** Each rule keeps one aggregate
> last-seen across everything its selector matches, so a selector that matches a
> fleet (e.g. `match: { plugin: "logTail" }` with no `site`) stays "alive" as
> long as *any* member reports — it will not catch one dead site among many.
> For per-device heartbeats, write one rule per site (`match: { site: "..." }`).

### What your program receives

Your program is operator-trusted, but packet **content is not** — so it only
ever arrives as *data*, never interpolated into a command. The watcher spawns
with `shell:false`, so a field containing `$(rm -rf /)` is inert bytes. Three
channels:

- **stdin** — the rendered `message` (or, with `format: "json"`, a JSON object).
- **argv** — exactly your static `args`. Packet data never lands here.
- **env** — a minimal clean environment: `PATH` plus the `FLU_*` vars below. The
  watcher's own environment (TLS keys, API keys) is **never** inherited.

| `message` placeholder | env var            | value                                                |
| --------------------- | ------------------ | ---------------------------------------------------- |
| `{{rule}}`            | `FLU_RULE`         | the rule name                                        |
| `{{reason}}`          | `FLU_REASON`       | `match` (storm), `silence`, or `recover`             |
| `{{count}}`           | `FLU_COUNT`        | matches represented (includes coalesced ones)        |
| `{{site}}`            | `FLU_SITE`         | packet site                                          |
| `{{plugin}}`          | `FLU_PLUGIN`       | packet plugin                                        |
| `{{description}}`     | `FLU_DESCRIPTION`  | packet description                                   |
| `{{ts}}`              | `FLU_TS`           | packet timestamp                                     |
| `{{seq}}`             | `FLU_SEQ`          | packet sequence number                               |
| `{{text}}`            | `FLU_TEXT`         | joined field text (capped at 4000 chars)             |
| `{{raw}}`             | `FLU_RAW`          | raw payload, if the packet carried one               |
| `{{silenceSec}}`      | `FLU_SILENCE_SEC`  | seconds of silence (silence trigger)                 |
| `{{lastSeen}}`        | —                  | last-seen timestamp (silence trigger)                |
| `{{window}}`          | —                  | the trigger window, human-readable                   |

With `format: "json"`, stdin is `{ rule, reason, count, packet }` for a match,
or `{ rule, reason, count, silenceSec, lastSeen }` for a silence — pipe it to
`jq`.

### Recipe: notify when a heartbeat goes silent

1. Create the alert script and make it executable:

   ```sh
   sudo install -d /etc/fluidity/alerts
   sudo tee /etc/fluidity/alerts/ntfy.sh >/dev/null <<'EOF'
   #!/bin/sh
   # Forward a Fluidity alert to an ntfy topic. The rendered message arrives on
   # stdin; FLU_* env vars carry the structured fields.
   TOPIC="${NTFY_TOPIC:-https://ntfy.sh/my-fluidity-alerts}"
   curl -s -H "Title: Fluidity: ${FLU_SITE} (${FLU_REASON})" -H "Tags: warning" \
        -d "$(cat)" "$TOPIC" >/dev/null
   EOF
   sudo chmod +x /etc/fluidity/alerts/ntfy.sh
   ```

2. Add a rule to the watcher config:

   ```json
   {
       "name": "greenhouse-heartbeat",
       "match": { "site": "greenhouse" },
       "trigger": { "type": "silence", "window": "120s" },
       "exec": "/etc/fluidity/alerts/ntfy.sh",
       "message": "{{site}} has been silent for {{silenceSec}}s (last seen {{lastSeen}})",
       "cooldown": "10m",
       "recover": true
   }
   ```

3. `npm run start:watcher`. When `greenhouse` stops reporting for two minutes
   you get one push; you get another when it recovers; and the `10m` cooldown
   keeps a flapping site from spamming you.

### Test rules safely with `dryRun`

Set `"dryRun": true` at the top level of the watcher config to validate rules
against live traffic **without executing anything** — each would-be alert is
logged (`[dryRun] would exec …`) instead of run. Confirm your selectors and
windows fire as expected, then turn it off.

### Built-in protections (and how to tune them)

The watcher is hardened against two failure modes. **Fork-bomb:** a global
concurrency cap, a bounded queue that sheds and counts excess, and an exec
timeout that kills a wedged child. **Message-bomb:** the per-rule `cooldown`
(coalescing suppressed matches into the next message — the primary
notification-spam guard), the per-rule `maxPerHour` token bucket, and a circuit
breaker that parks a rule whose program keeps failing or timing out. Override
the global bounds under `limits` if the defaults don't fit:

```json
"limits": { "maxConcurrent": 4, "queueCap": 64, "execTimeoutMs": 10000, "failureThreshold": 5, "circuitMs": 300000 }
```

Alert state is in-memory and resets on restart (last-seen is re-seeded from
`/FIFO` on reconnect); there is no persisted history yet.

---

## Load & stress testing

Operational tooling for capacity planning and validating backpressure:

- **`npm run sim:udp`** — fire a simulated UDP device fleet at a dev agent's
  `udpStruct` collector (`--secret <hex32>` for signed traffic, `--once` for a
  single burst).
- **`npm run sim:udp-stress -- --rate 2000 --duration 10 --mix valid:50,garbage:50`**
  — a rate-controlled barrage with exact sender-side counts to reconcile against
  the collector's drop counters. The agent sheds excess as `backpressure`
  rather than queueing it, so a flood costs display lines, never memory.
- **`npm run loadtest -- --rate 20000 --duration 10 --mix valid:70,garbage:30 --sse 16`**
  — drives the whole pipeline end to end (real datagrams → real agent collector
  → real HTTPS → real server, with optional SSE subscribers) and reports
  throughput, drops, backpressure, event-loop lag, and memory.

---

## Troubleshooting

| Symptom                                   | Likely cause / fix                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A component won't start                   | Invalid JSON in its config — run the file through a validator. A stray comma is the usual culprit.      |
| Browser certificate warning (dev)         | Expected with the bundled self-signed certs. Accept it for local use; use real certs in production.     |
| Agent can't post / 401-style failures     | Key mismatch — the agent's `targets[].key` must equal one of the server's `permittedKeys`.              |
| A collector you configured isn't running  | Check the `enabled` flag — and watch for a **quoted** `"false"`, which is truthy (the agent warns).     |
| Config edits seem ignored                 | Wrong file for the mode — `dev_conf.json` is loaded under `NODE_ENV=development`, `prod_conf.json` under production. |
| Watcher exits at startup                  | `watch` is required; every enabled rule's `exec` must exist and be executable (it fails loud on purpose). |
| Watcher fires nothing                     | Rule disabled, no enabled rules armed, or the watcher is disconnected (absence checks pause while blind — check its log). |
| Watcher fires too often                   | Raise `cooldown` / lower `maxPerHour`; both throttle per rule.                                           |

See **[INSTALL.md](INSTALL.md)** for build/run details and
**[CLAUDE.md](CLAUDE.md)** for architecture conventions and gotchas.
