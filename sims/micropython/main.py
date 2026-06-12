# Fluidity flu_packet_v1 publisher - MicroPython (Pico W, ESP32, ...)
#
# Sends a packed UDP struct straight to an agent's `udpStruct` collector - no
# TLS, JSON, or HTTP on the device. The device names its own site, so it shows
# up on the dashboards as a first-class site with its own pill + liveness dot.
#
# Setup:
#   1. copy BOTH fluidity_udp.py and this main.py onto the board
#      (e.g. with `mpremote cp` or Thonny)
#   2. fill in the config block below. For MAC mode, generate a key with
#      `openssl rand -hex 16` and give the SAME hex to the agent collector:
#        { "plugin": "udpStruct", "port": 17996,
#          "extendedOptions": { "secret": "<hex>", "requireMac": true,
#                               "replayWindow": 64 } }
#      Leave SECRET = None for open mode on a trusted LAN
#        ({ "plugin": "udpStruct", "port": 17996 } - no secret).
#   3. reset the board and watch the site pill appear on the dashboard.
#
# CircuitPython: fluidity_udp.py is identical; only the networking below
# changes - use `wifi.radio.connect(...)` and a `socketpool.SocketPool`
# instead of `network.WLAN` / `socket`. The build_packet/sign calls are the same.

import time
import network
import socket
import fluidity_udp as flu

# ---- configure me -------------------------------------------------------
WIFI_SSID = "your-ssid"
WIFI_PASS = "your-password"
AGENT_HOST = "192.168.1.10"  # box running the agent
AGENT_PORT = flu.PORT_DEFAULT  # 17996

# openssl rand -hex 16  ->  MUST match the agent's `secret`. None = open mode.
SECRET = None  # e.g. "0123456789abcdef0123456789abcdef"

SITE = "greenhouse"  # becomes a first-class site pill
PLUGIN = "pico-env"  # shown as the packet's plugin
DESCRIPTION = "soil probe"

HEARTBEAT_S = 15  # <=100s keeps the liveness dot glowing
# -------------------------------------------------------------------------

KEY = flu.key_from_hex(SECRET) if SECRET else None


def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        wlan.connect(WIFI_SSID, WIFI_PASS)
        while not wlan.isconnected():
            time.sleep(0.5)
    print("wifi:", wlan.ifconfig()[0])


def read_sensors():
    # swap in real sensor reads. style 0..10 maps to the dashboard palette;
    # style 5 reads as an "event" tone, 10 as the quiet/ok tone.
    import gc

    return [
        (0, "uptime %ds" % (time.ticks_ms() // 1000)),
        (10, "free %dB" % gc.mem_free()),
    ]


def main():
    connect_wifi()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    addr = socket.getaddrinfo(AGENT_HOST, AGENT_PORT)[0][-1]

    seq = 0
    while True:
        fields = read_sensors()
        if KEY:
            # signed datagrams use the full struct form (sign() appends the trailer)
            pkt = flu.sign(flu.build_packet(SITE, PLUGIN, DESCRIPTION, fields, seq, full=True), KEY)
        else:
            pkt = flu.build_packet(SITE, PLUGIN, DESCRIPTION, fields, seq)
        sock.sendto(pkt, addr)

        seq = (seq + 1) & 0xFFFF  # device_seq is a 16-bit counter; wrap is fine
        time.sleep(HEARTBEAT_S)


main()
