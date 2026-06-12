# Fluidity UDP Ingest — Specification

Status: **U1 + U2 + U3 implemented** — codec, collector, SipHash-2-4 MAC
with migration mode, optional replay window, sim, firmware kit
(`firmware/fluidity_udp.h` + example sketches), tests. The C header is
host-compiled in CI and pinned byte-for-byte against the agent codec and
the sim packer; the only acceptance step left for U3 is ceremonial — a
physical board on a real LAN. All open questions resolved (§11).

Microcontrollers (M5Stack/ESP32, Arduino, AVR, ARM) publish telemetry into
Fluidity by sending a **packed C struct over UDP** to a Fluidity **agent**,
which validates and decodes it into a normal FluidityPacket and forwards it
upstream over the existing HTTPS + API-key path. Dashboards (web and TUI)
need no changes — packets are packets.

```
MCU ──UDP packed struct──▶ Agent (udpStruct collector)
                             │ validate magic/length/MAC, decode,
                             │ suggest (FormattedData), throttle, count drops
                             ▼
                           HTTPS POST + X-Api-Key ──▶ Server ──SSE──▶ Web / TUI
```

## 1. Goals / non-goals

**Goals**

- Firmware-trivial publishing: `sendto(sock, &pkt, sizeof pkt)` from C on
  an 8-bit AVR upward. No TLS, no JSON, no HTTP on the device.
- Loss-tolerant telemetry semantics (Fluidity is a rolling display log;
  a dropped datagram costs one line, never integrity).
- The agent remains the trust boundary and protocol adapter — the server's
  single hardened ingest path is unchanged (and Heroku, which cannot accept
  UDP, keeps working untouched).
- Hostile-input discipline equal to the hardened srsSerial collector:
  strict validation, never a wrong decode, drops counted by reason.
- Devices ride the existing UX for free: site pills, liveness dots/marks,
  filtering, sparkline.

**Non-goals**

- Commands *to* devices (this is one-way telemetry).
- TCP, MQTT, CoAP, DTLS (a broker or handshake state machine on-device
  defeats the point; revisit only with a concrete need).
- WAN exposure. The UDP port is a LAN-only surface by design.
- Guaranteed delivery or ordering.

## 2. Placement

- New agent collector plugin: `service/src/agent/modules/collectors/udpStruct.ts`.
- The wire codec lives in its own pure module
  (`service/src/agent/modules/udpCodec.ts`) so a future direct-server
  listener (agent-less LAN topology) could reuse it verbatim. That listener
  is **out of scope** for U1–U3.
- Deployment shapes (both already supported by the agent model):
  1. piggyback on an existing agent box (add a stanza to its config);
  2. a dedicated gateway agent whose config contains only `udpStruct`.

## 3. Wire format v1 (normative)

Little-endian. Packed (`__attribute__((packed))` on GCC/Clang). All listed
target MCUs are little-endian, so firmware copies structs byte-for-byte;
the agent does any interpretation work.

```c
#define FLU_MAGIC   0x31554C46u   /* bytes "FLU1" on the wire */
#define FLU_VERSION 1
#define FLU_MAX_FIELDS 4

/* flags */
#define FLU_F_TS    0x01          /* ts_epoch is valid device time (UTC) */
#define FLU_F_MAC   0x02          /* SipHash-2-4 trailer present */

typedef struct __attribute__((packed)) {
    uint32_t magic;               /* FLU_MAGIC */
    uint8_t  version;             /* FLU_VERSION */
    uint8_t  flags;
    uint16_t device_seq;          /* monotonic, wraps; 0 allowed */
    uint32_t ts_epoch;            /* unix seconds UTC; ignored unless FLU_F_TS */
    char     site[16];            /* NUL-padded UTF-8 */
    char     plugin[16];          /* e.g. "m5-env", "avr-door" */
    char     description[16];     /* e.g. "greenhouse", "gate-1" */
    uint8_t  field_count;         /* 1..FLU_MAX_FIELDS */
    struct {
        uint8_t style;            /* suggestStyle 0..10 or >=100 (trim) */
        uint8_t reserved;         /* 0; fieldType STRING implied in v1 */
        char    text[40];         /* NUL-padded UTF-8 */
    } fields[FLU_MAX_FIELDS];
    /* if FLU_F_MAC: uint8_t mac[8] follows the struct */
} flu_packet_v1;
```

### 3.1 Offsets and sizes

| offset | size | field |
|---|---|---|
| 0 | 4 | magic |
| 4 | 1 | version |
| 5 | 1 | flags |
| 6 | 2 | device_seq |
| 8 | 4 | ts_epoch |
| 12 | 16 | site |
| 28 | 16 | plugin |
| 44 | 16 | description |
| 60 | 1 | field_count |
| 61 | 42×n | fields[n] (style, reserved, text[40]) |
| 61+42×4 = 229 | — | end of full struct |
| (end) | 8 | mac trailer (only when FLU_F_MAC) |

Maximum datagram: 237 bytes — far below any sane MTU, and a comfortable
stack buffer even on a 2KB AVR.

### 3.2 Accepted datagram lengths (exact-or-drop)

A datagram is accepted only if its length is **exactly** one of:

- `61 + 42*field_count` (+8 when FLU_F_MAC) — compact form, or
- `229` (+8 when FLU_F_MAC) — full struct (firmware sends `sizeof`),
  with fields beyond `field_count` ignored.

Anything else is dropped and counted. On a checksum-less... rather, on a
fire-and-forget transport feeding an operations display, a dropped datagram
beats a misparsed one (same doctrine as the serial decoder).

### 3.3 String and field rules

- Strings are UTF-8, NUL-padded; decoding stops at the first NUL. A string
  occupying its full width with no NUL is valid (max length = width).
- `site` and `plugin` must be non-empty after trimming; `description` may
  be empty (rendered as the plugin name). Invalid UTF-8 → datagram dropped
  (`bad-encoding`).
- Control characters are not the agent's problem to render (clients
  sanitize), but the agent strips NULs/CR/LF defensively before forwarding.
- `style` maps directly to `suggestStyle` (the suggestion contract reaches
  firmware). `reserved`/fieldType: v1 emits STRING fields only; a nonzero
  reserved byte is tolerated and ignored (room for LINK/DATE in v2).
- `field_count` of 0 or >4 → dropped (`bad-fields`).

### 3.4 Timestamps

- `FLU_F_TS` unset (the default for clockless devices): the agent stamps
  arrival time. This is the recommended mode; it also keeps liveness honest.
- `FLU_F_TS` set: `ts_epoch` (unix seconds, UTC) is used if it is within
  ±24h of agent time; otherwise the agent stamps and counts `bad-time`
  (a device with a wild clock should not corrupt the display order).
- u32 epoch is fine until 2106; v2 can widen if Fluidity is still flowing.

## 4. Authentication (optional, per collector)

- **Open mode** (default): any well-formed datagram on the bound interface
  is accepted. Suitable for trusted LANs; the collector logs a one-line
  notice at startup that auth is off.
- **MAC mode**: config supplies a 16-byte hex secret. Devices append
  `mac[8]` = **SipHash-2-4** (standard 8-byte output) computed over all
  preceding bytes with that key, and set FLU_F_MAC. SipHash was chosen
  over HMAC-SHA256 deliberately: it is small and fast on 8-bit AVRs and
  costs nothing on ESP32/ARM. Wrong/missing MAC → drop (`bad-mac`).
- Replay (implemented in U2, **off by default**): `replayWindow: N`
  (1..1024, requires a secret — unsigned sequence numbers are
  attacker-chosen values, not evidence) enforces a strict per-device
  window over MAC-verified packets only. Device identity is
  (site, plugin); one physical device per identity when the window is on.
  Accept iff `(seq - anchor) mod 2^16` is in `1..N`; accepted packets
  advance the anchor. An out-of-window packet is dropped (`replay`), but
  two *coherent* consecutive rejects (the second advancing `1..N` past the
  first — a device counting up from reset) re-anchor the window, so a
  reboot costs exactly one packet and firmware needs no persistent
  counter. Honest limit: an attacker who captured a consecutive signed
  pair can force one stale line through and momentarily steal the anchor
  (the device then re-anchors back the same way). It is a replay *damper*
  for display integrity, not a transcript authenticator.
- Defense in depth regardless of mode: `bind` to a LAN interface, never
  port-forward this from the WAN, and remember the upstream hop still
  requires the real API key — a LAN attacker can pollute the *display*,
  not impersonate the agent elsewhere.

## 5. Collector configuration

```json
{
    "description": "LAN sensors",
    "plugin": "udpStruct",
    "port": 17996,
    "bind": "0.0.0.0",
    "extendedOptions": {
        "secret": "0123456789abcdef0123456789abcdef",
        "requireMac": true,
        "replayWindow": 64,
        "siteFromPacket": true
    }
}
```

- `port` (required): default suggestion **17996** (0x464C, "FL").
- `bind` (optional, default all interfaces): set to the LAN interface
  address on multi-homed gateways.
- `secret` + `requireMac`: MAC mode as above. `secret` present with
  `requireMac:false` accepts both (migration mode), counting unsigned
  packets separately (`unsigned`). Misconfigured security options refuse
  to start the agent — they never warn-and-fallback to something weaker.
- `replayWindow`: the strict sequence window of §4 (1..1024; needs
  `secret`). Off when absent.
- `siteFromPacket` (default **true**): the datagram's `site` becomes the
  FluidityPacket site, so each device (or device cluster) is a first-class
  site with its own pill and liveness dot. Set false to stamp the agent's
  configured site instead (devices then differ by description/plugin).
  NOTE: this is the one place the base collector contract loosens — packet
  construction must accept per-packet site/description overrides. Small,
  contained change in `collectors.ts`, used only by this plugin.
- Existing collector knobs apply: `keepRaw` stores the datagram as lowercase
  hex (capped at full struct size); `maxHttpsReqPerCollectorPerSec`
  throttles upstream as usual (a boot-looping device cannot flood f-y.io).

## 6. Validation pipeline and observability (normative order)

1. length sanity (61..237) → `bad-length`
2. magic → `not-fluidity` (logged at debug only; LANs are noisy)
3. version → `bad-version`
4. exact-length rule (3.2) → `bad-length`
5. MAC policy (4) → `bad-mac` / count `unsigned`
6. field_count bounds → `bad-fields`
7. UTF-8 + required strings → `bad-encoding` / `bad-identity`
8. timestamp policy (3.4) → may count `bad-time` (packet still accepted)
9. upstream backpressure → `backpressure`: the throttled HTTPS path keeps
   a bounded in-flight backlog (`max(32, 2×maxHttpsReqPerCollectorPerSec)`);
   beyond it the newest packet is shed and counted. A flood of valid
   packets must cost lines, never agent memory (and the throttle queue
   offers no cancellation, so shedding old work is not an option).

All drops are counted by reason in `collector.dropCounts` (same surface the
hardened srsSerial exposes) and logged at debug with source address. A
per-source-address counter guards log spam: after N drops from one source,
further drops from it log every 100th occurrence.

## 7. Packet mapping

| FluidityPacket | from |
|---|---|
| site | datagram `site` (or agent site, per `siteFromPacket`) |
| plugin | datagram `plugin` |
| description | datagram `description` (or plugin if empty) |
| ts | agent arrival time, or device time per 3.4 |
| formattedData | one STRING entry per field: `{suggestStyle: style, field: text}` |
| rawData | hex dump when `keepRaw`, else null |
| seq | server-assigned, as always |

Heartbeat guidance for firmware: send at least one packet every **≤100s**
(a status/heartbeat field is fine). This matches the cadence the liveness
thresholds were derived from, so device sites glow/fade exactly like SRS
sites do.

## 8. Firmware deliverables (U3) — shipped

- `firmware/fluidity_udp.h` — the normative struct with compile-time
  offset asserts, `flu_init/flu_set_field/flu_set_time/flu_wire_size`,
  and SipHash-2-4 + `flu_sign` behind `FLU_ENABLE_MAC`. Signed datagrams
  always use the full-struct form (237 bytes): the trailer must follow
  the signed bytes, and fixed-size keeps firmware trivial. Big-endian
  targets fail at compile time rather than emit a byte-swapped wire.
- Example sketches under `sims/arduino/`:
  - `udp-m5stack/` — ESP32/M5Stack via WiFiUDP, MAC mode, NTP device time;
  - `udp-avr-w5500/` — classic Arduino/AVR via Ethernet, open mode,
    compact form, event+heartbeat publishing.
- README section "UDP Devices (Microcontrollers)": first packet from a
  shell via `xxd -r -p | nc -u` (validated live against a dev agent).
- `firmware/test/wirecheck.c` + `tests/udpFirmware.test.ts`: the header is
  host-compiled (`-Wall -Wextra -Werror`) and its datagrams compared
  byte-for-byte against the agent codec and sim packer; the C SipHash is
  compared against the TS implementation on the official-vector inputs.
  Skips cleanly on hosts without a C compiler; CI always has one.

## 9. Sims and testing

- **Codec tests** (pure): encode/decode round-trips via a Buffer builder in
  the test helpers; every drop reason exercised (truncated, oversized,
  bad magic/version, length-vs-count mismatch, bad UTF-8, empty site,
  field_count 0/5, wild timestamps, MAC wrong/missing/unsigned-allowed).
- **Collector tests**: in-test `dgram` socket → agent collector → local
  HTTPS target (the pipeline.test.ts pattern): datagram in, FluidityPacket
  on the wire out, byte-validated; throttle behavior; dropCounts.
- **Sim**: `sims/src/udpDeviceSim.ts` — seeded PRNG device fleet (a few
  sites, heartbeats + occasional events) firing real datagrams at a
  configurable port; used for dev demos exactly like `sim://srs`, and a
  `--once` mode for smoke scripts.
- **Stress emitter**: `sims/src/udpStressEmitter.ts` (`npm run
  sim:udp-stress`) — rate-controlled, seed-deterministic barrage with a
  traffic mix (`valid` / `garbage` / `tampered` / `unsigned`), exact
  sender-side counts for reconciliation against `dropCounts`. Exercises
  decode/drop at volume and the backpressure shed (§6 step 9).
- **Golden fixture**: once the first real device runs, capture a datagram
  set to `sims/fixtures/` and pin the decoder to it (the srsSerial/f-y.io
  precedent).

## 10. Milestones

**U1 — codec + collector (the core)**
udpCodec module, udpStruct collector (open mode), site-override mechanics,
drop counters, sim, full test coverage. *Accept:* sim fleet → agent →
dev server → web/TUI shows device sites with working liveness dots; suite
green; a malformed-datagram fuzz loop (random bytes) produces zero decoded
packets and zero crashes.

**U2 — authentication ✅**
SipHash-2-4 trailer verify, `requireMac`/migration mode, and the
`device_seq` strict window (off by default). *Accepted:* signed sim
traffic passes a MAC-required collector e2e; tampered/unsigned datagrams
drop with `bad-mac`; replays drop with `replay` and a rebooted device
re-anchors at the cost of one packet; the primitive is pinned to all 64
official SipHash reference vectors; measured ~34k MACs/s over max-size
datagrams on a dev box (BigInt impl) — orders of magnitude past the
1k/s-on-a-Pi bar.

**U3 — firmware kit ✅ (software-complete)**
`fluidity_udp.h`, the two example sketches, README quickstart. *Accepted
so far:* the header compiles warning-free under gcc and clang, its
datagrams (open compact/full, timestamped, MAC-signed) are byte-identical
to both TypeScript implementations, a C-signed datagram passes the agent's
verify path, and the README first-packet line was validated against a live
dev agent. *Remaining:* the ceremonial hardware walk — a real M5Stack on
the LAN appearing on an f-y.io-style dashboard with MAC mode on.

## 11. Resolved decisions (2026-06-11)

1. **Default port: 17996** (0x464C, "FL"); always overridable per collector.
2. **`siteFromPacket` defaults true** — devices are first-class sites with
   their own pills and liveness dots.
3. **Replay protection (U2): available, off by default.** Strict
   `device_seq` window 1..1024 behind a config flag; the window re-anchors
   when a device resets, so firmware needs no persistent counter.
   *Implemented in U2 as specified — semantics in §4.*
4. **One shared secret per collector.** Per-device keys remain addable
   without a wire change (the agent can key lookup off the packet's
   site/plugin) if ever needed.
5. **Fields stay 4 x text[40]** — four individually styled segments,
   237-byte max datagram, as specified in §3.
