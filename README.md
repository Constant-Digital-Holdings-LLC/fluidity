# Fluidity

Fluidity is an extensible lightweight real-time aggregator for serial data. It runs on all modern operating systems and allows for very fast centralized viewing (with syntax highlighting). The user interface is clean and mobile friendly.

You can see a live demonstration of Fluidity, with actual production data, here:

https://f-y.io/

In the aforementioned, Fluidity is being used to display distributed communication devices called "Sierra Radio Systems (SRS) Controllers". While this is a more advanced usecase, it can be used to aggregate any serial data.

#### Architecture (all 3 reside in the same mono-repo):

-   Agent
-   Web Service
-   Dashboard

The Agent is reponsible for connecting to _n_ local serial devices. Devices are associated with a plugin which suggests how the data should be delimited and stylized, or the generic plugin if a data-specific plugin is unavailable. As serial data streams in, the Agent immediately posts the corresponding data to the webservice. Devices are read and published in parallel.

The Web Service simply maintains a running FIFO of agent submitted data, for consumption by the dashboard. The Web Service utilizes Server-Sent Events (SSE) to ensure real-time client rendering. The FIFO keeps a configurable amount of running historical data.

The Dashboard responds to incoming Server Sent Events and renders the data, utlizing hints provided by the edge plugins (in the Agent).

#### Target Audiences:

-   Commercial IOT
-   "Maker" Communities
-   Communications

Fluidity has no internet dependences. The dashboard intentionally does not utlize external internet resources (js delivery CDNs, etc). So the entire stack can run, self contained, on a local LAN without external connectivity.

## Getting Strated

It's recommended that you run all 3 components on a single computer, initially, in order to famliarize yourself with the stack.

You don't need any serial hardware to try Fluidity: the agent ships with built-in simulated serial devices. Set a collector's `path` to `sim://generic` (or `sim://srs` for the SRS plugin) and the agent emits realistic sample data in software, exactly as if an Arduino test device were attached. Use a real device path (e.g. `/dev/tty.usbmodem11201` or `COM4`) when you have actual hardware.

Upon downloading the repository locally, first edit : **service/dist/agent/conf/dev_conf.json** and customize the below as you see fit. If you are testing with a single local serial device, replace the `sim://` path in the "Device Foo" stanza with your device's path, or delete a stanza so only one collector runs within the agent.

---

`{`

`"targets": [{ "location": "https://localhost:3000/FIFO", "key": "184f451d98b79137dcb014abda5eb6c9" }],`

`"site": "MyOffice",`

`"logLevel": "debug",`

`"collectors": [`

​ `{`

​ `"description": "Agent Report",`

​ `"plugin": "vRep",`

​ `"pollIntervalSec": 1800`

​ `},`

​ `{`

​ `"description": "Device Foo",`

​ `"plugin": "genericSerial",`

​ `"path": "sim://generic",`

​ `"baudRate": 9600`

​ `},`

​ `{`

​ `"description": "Device Bar",`

​ `"plugin": "srsSerial",`

​ `"path": "sim://srs",`

​ `"baudRate": 9600`

​ `}`

`]`

`}`

---

Next edit **service/dist/server/conf/dev_conf.json**:

{

"org": "MyOrg",

"port": 3000,

"tlsKey": "ssl/dev-server_key.pem",

"tlsCert": "ssl/dev-server_cert.pem",

"permittedKeys": ["184f451d98b79137dcb014abda5eb6c9"],

"httpCacheTTLSeconds": 5,

"logLevel": "debug"

}

---

Download Node.js: https://nodejs.org

From the root of the respository, run `npm install`

At this point we're ready to start everything up

Start the service, in local/debug mode by running: `npm run dev:server`

If you encounter any startup errors, be sure run your config files through a JSON validator. The JSON format can be unforgiving if there are sytax errors.

Assuming the server started and is running on localhost:3000, go ahead and start the agent: `npm run dev:agent`

Now you should see your local serial device data displayed on the dash here: https://localhost:3000

You can ignore any local certificate errors, since this is just a local / test install

#### Moving to Production...

Using the previous examples, edit : **service/dist/agent/conf/prod_conf.json**. This time make sure you use a secret, unique key in your config. For convenince, you can generate a key using **service/dist/agent/bin/genApiKey.js**

Make sure "targets" points to the actual production location where the service will reside (likely on port 443)

Edit **service/dist/server/conf/prod_conf.json**

The server-side can have the key specified in the config -or- in an env variable called `PERMITTED_KEY`

In addition to specifying the unique key, be sure to provide the paths for _valid_ TLS pem files. In produciton mode Fluidity verifies the cert chain.

Change port to 443 and org to something specific for your organization

Once the agent and service are configured, run:

`npm install` (if you have not done so already)

`npm run start:server`

`npm run start:agent`

#### Simulated Devices & Testing

The simulators live in **sims/** as a TypeScript library (`sims/src/`). Any serial collector can be pointed at a simulator by using a `sim://` path in its config (`sim://srs` for SRS controller telemetry, `sim://generic` for assorted serial console data). Simulated devices behave like real ones: same parsers, same plugins, same data path to the dashboard.

The SRS simulator is a stateful model of a real controller's telemetry stream (per SRS Command List command C22A, validated against live production data): single-port COR events alternating between linked ports, release-to-zero state changes, and 100-second status heartbeats.

By default the srsSerial plugin hides messages that contain nothing but carrier detect (in practice ~90% of real traffic is COR-only noise); messages carrying anything more pass through complete. Tune this per collector with `"extendedOptions": { "suppress": [...] }` — an empty list shows everything, and any radio/port state name (e.g. `"LINK"`, `"LOOPBACK"`) can be added to the list. Equivalent Arduino sketches for driving a real serial port from a microcontroller live in **sims/arduino/**.

Run the test suite (no hardware required) with:

`npm test`

#### Terminal Client (TUI)

Fluidity includes a terminal client that renders the same live stream in your terminal — including over SSH, and on the Raspberry Pi OS text console. With a local dev server running:

`node tui/dist/app.js`

(or `npx fluidity-tui` once installed). It defaults to `https://localhost:3000`; point it elsewhere with `--server https://your-host`. On a terminal you get the interactive view: a bottom pane lists every site reporting in with live counts — press `1`-`9` to filter by them, `Tab` to switch to collectors, `space` to pause, `?` for help. When piped (or with `--follow`/`--json`) it streams plain lines instead: `--json` emits raw packet NDJSON (pipe to `jq`), `--site`/`--collector` pre-filter, `--color never|16|256|truecolor` overrides detection. See `tui/SPEC.md` for the full design.

If you want fancy syntax colarization/highlighting, plugins (collectors) are very easy to develop. I'm planning on writing a guide here soon on how to add plugins.

Feel free to log an issue if you need assistance. For my amateur radio friends, I'm 'good on QRZ' -KK6BEB
