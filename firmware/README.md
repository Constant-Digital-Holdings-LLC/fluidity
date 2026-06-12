# Fluidity firmware kit — publishing from a microcontroller

A microcontroller publishes into Fluidity by sending one small **packed binary
struct over UDP** to an agent running the `udpStruct` collector. No TLS, JSON,
or HTTP on the device — the agent is the trust boundary and protocol adapter.
Each device names its own **site**, so it appears on the dashboards as a
first-class site with its own pill and liveness dot.

The full wire format and security model are normative in
[`../service/UDP-SPEC.md`](../service/UDP-SPEC.md). This folder and the
examples are the developer-facing on-ramp.

## What's here / where to start

| You are… | Start with |
| --- | --- |
| On **Arduino / ESP32 / AVR (C/C++)** | [`fluidity_udp.h`](fluidity_udp.h) — single dependency-free header (`flu_init` / `flu_set_field` / `flu_wire_size`, `flu_sign` behind `FLU_ENABLE_MAC`) |
| Want a **worked ESP32 sketch (MAC mode + NTP)** | [`../sims/arduino/udp-m5stack/`](../sims/arduino/udp-m5stack/) |
| Want a **classic AVR + Ethernet sketch (open mode)** | [`../sims/arduino/udp-avr-w5500/`](../sims/arduino/udp-avr-w5500/) |
| On **MicroPython / CircuitPython** | [`../sims/micropython/`](../sims/micropython/) — `fluidity_udp.py` (packing + SipHash) + `main.py` (Pico W / ESP32 example) |
| Porting to **another language** (Rust, Go/TinyGo, …) | the [porting table](#porting-the-wire-format-to-another-language) below + UDP-SPEC §3 |
| Implementing from the **spec** | [`../service/UDP-SPEC.md`](../service/UDP-SPEC.md) §3 (wire), §4 (auth), §6 (validation order) |

> The Arduino sketches live under `sims/arduino/` (not here) because they
> double as the reference for the software serial simulators. The MicroPython
> example is under `sims/micropython/` for the same symmetry. All three are
> independent implementations of the wire format, pinned byte-for-byte against
> this header and the agent decoder by the test suite (`udpFirmware.test.ts`).

## Try it with no hardware

Send a first packet from any shell (agent listening on 17996) — a site named
`hello` appears on the dashboard with the field "hi from netcat":

```sh
HEX=464c5531010000000000000068656c6c6f00000000000000000000006e632d746573740000000000000000006669727374207061636b65740000000001060068692066726f6d206e65746361740000000000000000000000000000000000000000000000000000
printf '%s' "$HEX" | xxd -r -p | nc -u -w1 your-agent-host 17996
```

(no `xxd`? — `perl -e 'print pack "H*", $ENV{HEX}' | nc -u -w1 your-agent-host 17996`)

A software fleet of simulated UDP devices is also available: `npm run sim:udp`
(`--once` for one burst, `--secret <hex32>` for signed traffic).

## Three gotchas worth knowing up front

1. **Arduino IDE only sees files beside the `.ino`.** Copy `fluidity_udp.h`
   into the sketch folder (don't `#include` it by path). The sketches say so
   in their setup comments; don't commit the copy back.
2. **The MAC key must match the agent's `secret` exactly** — same 16 bytes.
   `openssl rand -hex 16` generates one; put the hex in the collector's
   `extendedOptions.secret` and the bytes in the device.
3. **Heartbeat at least every ≤100 s.** Liveness dots on the dashboards glow
   and fade on that cadence; a device that only speaks on events looks dead
   between them. The examples send on change *and* on a heartbeat timer.

## Security: which mode?

Auth is per-collector and optional (UDP-SPEC §4). Pick by threat model:

- **Open mode** — no MAC. The agent stanza is just
  `{ "plugin": "udpStruct", "port": 17996 }`. Fine on a **trusted LAN** you
  control; keep the port off the WAN. Lowest device cost (no crypto).
- **MAC mode** — add `"secret": "<hex>", "requireMac": true`. Every datagram
  carries a SipHash-2-4 trailer; unsigned or tampered datagrams are dropped.
  Use it on a **shared/untrusted segment**. SipHash-2-4 is cheap even on an
  8-bit AVR (well past 1k packets/s on a Pi-class box).
- **MAC + replay window** — also add `"replayWindow": 64`. Rejects replays of
  captured signed datagrams within a per-device sequence window. Add it when
  an attacker could **capture and re-send** your traffic. Requires a secret.

Either way the agent is the only thing holding the real upstream API key — a
LAN attacker can at most pollute the *display*, never impersonate the agent.

### device_seq and the replay window

`device_seq` (offset 6, `u16`) is a per-device counter you increment each
packet; wrapping at 65535 is fine. With `replayWindow: N` the agent accepts a
sequence only if it advances 1..N past the last accepted one. You **do not
need persistent storage**: a rebooted device just counts up from 0 again, and
the window re-anchors after one packet (UDP-SPEC §4 has the exact rule). Open
mode and MAC-without-replay ignore the sequence entirely.

## Porting the wire format to another language

Little-endian throughout (every supported target is LE). UDP-SPEC §3.1 is
normative; this is the dev-friendly version.

**Header (61 bytes):**

| Offset | Size | Type | Field | Notes |
| ---: | ---: | --- | --- | --- |
| 0 | 4 | `u32` | magic | `0x31554C46` (the bytes `FLU1`) |
| 4 | 1 | `u8` | version | `1` |
| 5 | 1 | `u8` | flags | bit0 `FLU_F_TS` (0x01), bit1 `FLU_F_MAC` (0x02) |
| 6 | 2 | `u16` | device_seq | per-device counter; wraps at 65535 |
| 8 | 4 | `u32` | ts_epoch | unix seconds UTC; read only if `FLU_F_TS` set |
| 12 | 16 | `char[16]` | site | NUL-padded UTF-8, **non-empty** |
| 28 | 16 | `char[16]` | plugin | NUL-padded UTF-8, **non-empty** |
| 44 | 16 | `char[16]` | description | NUL-padded UTF-8, may be empty |
| 60 | 1 | `u8` | field_count | **1..4** (the logical count, even in full form) |

**Then `field_count` fields, 42 bytes each, starting at offset 61:**

| Rel. offset | Size | Type | Field | Notes |
| ---: | ---: | --- | --- | --- |
| +0 | 1 | `u8` | style | 0..10 = palette; ≥100 = trim + color (style % 10) |
| +1 | 1 | `u8` | reserved | 0 |
| +2 | 40 | `char[40]` | text | NUL-padded UTF-8 |

**Datagram length is exact-or-dropped:**

- **Compact** (recommended for unsigned): `61 + 42 × field_count` bytes.
- **Full**: the whole 4-field struct = **229** bytes (surplus fields ignored).
- **Signed**: set the `FLU_F_MAC` flag, then append an 8-byte **SipHash-2-4**
  trailer computed over *all preceding bytes* (the flag bit included). Firmware
  convention signs the **full** struct, so signed datagrams are `229 + 8 =
  237` bytes. The key is the agent's 16-byte `secret`; the 8-byte output is
  written little-endian.

Strings are NUL-padded UTF-8 and decoding stops at the first NUL; a string may
fill its whole width with no NUL. Truncating a multibyte char at the width
boundary is tolerated (the agent trims the dangling tail), but cleaner to avoid.

`fluidity_udp.h` and `sims/micropython/fluidity_udp.py` are concise reference
implementations of exactly this layout if you want code to read alongside the
table.
