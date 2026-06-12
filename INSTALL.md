# Installing Fluidity

Mechanical setup — prerequisites, build, run, and production deploy. Once it's
running, see **[RUNBOOK.md](RUNBOOK.md)** for configuring data sources, viewing
the stream, and setting up alerting.

You don't need any serial hardware to get started: the agent ships with
built-in simulated devices.

## Prerequisites

- **Node.js 20 or later** — <https://nodejs.org>
- **git**

That's it. Fluidity has no internet runtime dependencies — the whole stack runs
self-contained on a LAN.

## 1. Get the code

```sh
git clone https://github.com/Constant-Digital-Holdings-LLC/fluidity.git
cd fluidity
npm install
```

`npm install` compiles nothing on its own; build (or just run the tests) when
you want to confirm a clean tree:

```sh
npm run build   # tsc --build across client, sims, service, tui
npm test        # builds, then runs the full suite (no hardware/network needed)
```

## 2. Configure (a minimal local trial)

Fluidity reads JSON config from `conf/` directories that ship **inside
`service/dist/`**. `NODE_ENV` selects which file overlays the always-loaded
`common_conf.json`:

| `NODE_ENV`    | file loaded            |
| ------------- | ---------------------- |
| `development` | `conf/dev_conf.json`   |
| `production`  | `conf/prod_conf.json`  |

The `dev:*` and `start:*` npm scripts set `NODE_ENV` for you (`dev` →
development, `start` → production). Reference copies of every file live under
each `conf/conf-examples/`.

> **Why config lives under `dist/`:** build output is committed by design, and
> these directories also hold runtime config and the TLS certs. Don't run a
> blanket `clean` on `dist/` — it deletes your configuration.

**Server** — edit `service/dist/server/conf/dev_conf.json`:

```json
{
    "org": "MyOrg",
    "port": 3000,
    "tlsKey": "ssl/dev-server_key.pem",
    "tlsCert": "ssl/dev-server_cert.pem",
    "permittedKeys": ["184f451d98b79137dcb014abda5eb6c9"],
    "httpCacheTTLSeconds": 5,
    "logLevel": "debug"
}
```

**Agent** — edit `service/dist/agent/conf/dev_conf.json`:

```json
{
    "targets": [{ "location": "https://localhost:3000/FIFO", "key": "184f451d98b79137dcb014abda5eb6c9" }],
    "site": "MyOffice",
    "logLevel": "debug",
    "collectors": [
        { "description": "Agent Report", "plugin": "vRep", "pollIntervalSec": 1800 },
        { "description": "Simulated Serial", "plugin": "genericSerial", "path": "sim://generic", "baudRate": 9600 }
    ]
}
```

The agent's `targets[].key` **must equal** one of the server's `permittedKeys`
— that shared secret is how the server authorizes a posting agent. The value
above is the ships-with dev key; fine for localhost, replace it for production
(see below).

Adding real devices, log files, or microcontrollers is a runbook topic —
see **[RUNBOOK.md](RUNBOOK.md#data-sources-configuring-collectors)**.

## 3. Start it (development)

In two terminals:

```sh
npm run dev:server   # tsc watch + nodemon; serves the dashboard
npm run dev:agent    # tsc watch + nodemon; reads collectors, posts upstream
```

Open **<https://localhost:3000>**. Accept the browser's self-signed-certificate
warning (expected for the bundled dev certs) and you should see simulated
device data streaming live.

If a component fails to start, run its config file through a JSON validator — a
stray comma or missing quote is the usual cause.

## 4. Terminal client (optional)

```sh
node tui/dist/app.js          # or: npx fluidity-tui
```

It defaults to `https://localhost:3000`; point elsewhere by passing the server
URL as the first argument — `node tui/dist/app.js your-host:3000` (the scheme is
optional and defaults to https). See
**[RUNBOOK.md](RUNBOOK.md#viewing-the-stream)** for the interactive keys and
piped/JSON modes.

## Moving to production

1. **Generate a real API key:**

   ```sh
   node service/dist/agent/bin/genApiKey.js
   ```

2. **Server** — `service/dist/server/conf/prod_conf.json`: set `org`, `port`
   (typically `443`), and the new key. The key may live in config under
   `permittedKeys`, or be supplied via the `PERMITTED_KEY` environment
   variable. Provide **valid** TLS certs (`tlsKey`/`tlsCert`) — production
   verifies the certificate chain, unlike dev.

3. **Agent** — `service/dist/agent/conf/prod_conf.json`: point `targets` at the
   real server location and use the same key.

4. **Run:**

   ```sh
   npm run start:server
   npm run start:agent
   ```

**Crash-only by design:** the agent and watcher exit non-zero on a fatal error
rather than limping along in an unknown state. Run each component under a
supervisor that restarts it (systemd, pm2, `docker --restart=always`, etc.).
The clients self-heal across a server restart on their own.

The web service needs no inbound UDP, so it deploys to UDP-incapable PaaS hosts
(e.g. Heroku) unchanged — microcontrollers reach it through the agent's UDP
gateway instead (see the runbook).

## Self-contained TUI binaries

The TUI can be packaged as a single executable (no Node on the target). Release
tags build binaries for Linux (x64/arm64), macOS, and Windows automatically, or
build your own:

```sh
npm run build:tui-sea
```

See **[tui/BUILD.md](tui/BUILD.md)**.

## What runs where

| Component | Directory              | Start command           | Default endpoint                |
| --------- | ---------------------- | ----------------------- | ------------------------------- |
| Server    | `service/dist/server`  | `npm run start:server`  | `:3000` (dev) / `:443` (prod)   |
| Agent     | `service/dist/agent`   | `npm run start:agent`   | posts to `targets`              |
| Watcher   | `service/dist/watcher` | `npm run start:watcher` | subscribes to a server          |
| TUI       | `tui/dist`             | `node tui/dist/app.js`  | connects to a server            |

Use the `dev:server` / `dev:agent` variants during development for watch-mode
rebuilds.
