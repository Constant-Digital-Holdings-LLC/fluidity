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

Upon downloading the repository locally, first edit : **service/dist/agent/conf/dev_conf.json** and customize the below as you see fit. If you are testing with a single local serial device, delete the stanza for either "Device Foo" or "Device Bar", so only once collector will be running within the agent.

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

​ `"path": "/dev/tty.usbmodem11201",`

​ `"baudRate": 9600`

​ `},`

​ `{`

​ `"description": "Device Bar",`

​ `"plugin": "genericSerial",`

​ `"path": "COM4",`

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

If you want fancy syntax colarization/highlighting, plugins (collectors) are very easy to develop. I'm planning on writing a guide here soon on how to add plugins.

Feel free to log an issue if you need assistance. For my amateur radio friends, I'm 'good on QRZ' -KK6BEB
