# Fluidity

Fluidity is an extensible, lightweight, real-time aggregator for serial data. It
runs on all modern operating systems and offers very fast centralized viewing
with syntax highlighting. The interface is clean and mobile-friendly.

See a live demonstration with actual production data: **<https://f-y.io/>**

There, Fluidity displays distributed communication devices called "Sierra Radio
Systems (SRS) Controllers" — a more advanced use case, but Fluidity can
aggregate any serial data.

Fluidity has **no internet runtime dependencies**: the clients deliberately use
no external CDNs, so the entire stack runs self-contained on a local LAN.

## Documentation

| Guide                            | What it covers                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------- |
| **[INSTALL.md](INSTALL.md)**     | Prerequisites, build, run, and production deploy. Start here.                   |
| **[RUNBOOK.md](RUNBOOK.md)**     | Operating it: configuring data sources, viewing the stream, and **alerting**.   |
| [service/UDP-SPEC.md](service/UDP-SPEC.md) | The UDP wire format and security model for microcontrollers.          |
| [firmware/README.md](firmware/README.md)   | Microcontroller firmware kit (C, Arduino, MicroPython, porting table). |
| [tui/SPEC.md](tui/SPEC.md) · [tui/BUILD.md](tui/BUILD.md) | Terminal client design; building self-contained binaries. |
| [CLAUDE.md](CLAUDE.md) · [PLAN.md](PLAN.md) | Architecture conventions/gotchas; work log and design notes.       |

## Architecture

Five components, all in this monorepo:

- **Agent** — collects data from _n_ local devices (most commonly serial ports,
  each associated with a plugin that suggests how to delimit and stylize the
  data) and immediately POSTs each reading to the web service over HTTPS.
  Devices are read and published in parallel. The agent also acts as a **UDP
  forwarding gateway** for microcontrollers (ESP32/M5Stack, Arduino, AVR, ARM):
  its `udpStruct` collector decodes a tiny packed binary struct from the LAN and
  forwards it upstream — no TLS, JSON, or HTTP on the device. This makes the
  agent the single trust boundary, so the web service stays one hardened ingest
  path (and UDP-incapable PaaS hosts like Heroku keep working).
- **Web Service** — maintains a running FIFO of agent-submitted data and
  broadcasts it to clients in real time via Server-Sent Events (SSE). The FIFO
  keeps a configurable amount of history.
- **Dashboard** (web) and **Terminal Client / TUI** — subscribe to the SSE
  stream and render. By design, plugins only *suggest* (field types and style
  hints travel with each packet); the server relays without interpreting, and
  each client decides how to render — CSS for the browser, ANSI for the
  terminal.
- **Watcher** — a standalone subscriber that matches patterns on the stream and
  runs an alert program when a heartbeat goes silent or an event storms (e.g. an
  [ntfy](https://ntfy.sh) push). Independent of the server by design, so it
  outlives what it watches. See [RUNBOOK.md](RUNBOOK.md#alerting-the-watcher).

Data sources beyond serial ports: any growing **log file** (`logTail`
collector) and **microcontrollers over UDP** (`udpStruct`). You don't need any
hardware to try Fluidity — built-in simulators (`sim://generic`, `sim://srs`)
stand in for real devices using the same parsers and data path.

## Quick start

```sh
git clone https://github.com/Constant-Digital-Holdings-LLC/fluidity.git
cd fluidity
npm install
npm run dev:server   # in one terminal
npm run dev:agent    # in another
```

Open **<https://localhost:3000>** (accept the dev self-signed cert) to watch
simulated device data stream live. Full walkthrough, configuration, and
production deploy: **[INSTALL.md](INSTALL.md)**.

#### Target audiences

- Commercial IoT
- "Maker" communities
- Communications

## Development

- `npm run build` — compile all TypeScript projects (client, sims, service, tui)
- `npm test` — build and run the full suite (no hardware or network required;
  simulators stand in for devices, and a captured slice of real production data
  acts as golden test data)
- `npm run test:coverage` — the same, with the coverage thresholds CI enforces
- `npm run lint` — ESLint across all projects
- `npm run dev:server` / `npm run dev:agent` — watch mode with automatic rebuild
  and restart

Continuous integration (GitHub Actions) runs lint and the coverage-gated suite
on Node 20 and 24 for every push and pull request.

Plugins (collectors) are easy to add for custom syntax highlighting — a guide is
planned. Feel free to log an issue if you need assistance. For my amateur radio
friends, I'm 'good on QRZ' — KK6BEB.
