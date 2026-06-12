/*
  Fluidity flu_packet_v1 publisher - ESP32 / M5Stack (any ESP32-core board)

  MAC mode (UDP-SPEC s4): every datagram carries a SipHash-2-4 trailer and
  the matching agent collector runs with requireMac (and, recommended, a
  replayWindow). NTP gives the device a real clock, so packets ship device
  time (FLU_F_TS); the agent falls back to arrival time if NTP hasn't
  synced yet.

  Setup:
    1. copy firmware/fluidity_udp.h from the Fluidity repo into this
       sketch folder (the Arduino IDE only sees files beside the .ino)
    2. fill in the config block below; generate the key with
       `openssl rand -hex 16` and give the same hex string to the agent:
         { "plugin": "udpStruct", "port": 17996,
           "extendedOptions": { "secret": "<hex>", "requireMac": true,
                                "replayWindow": 64 } }
    3. flash, watch the site pill appear on the dashboards with a live
       liveness dot (the 15s heartbeat is well inside the 100s cadence)

  The two fields published here (uptime, free heap) compile on any ESP32
  without extra libraries - swap in real sensor reads where marked.
*/

#define FLU_ENABLE_MAC
#include "fluidity_udp.h"
#include <WiFi.h>
#include <WiFiUdp.h>
#include <time.h>

// ---- configure me -------------------------------------------------------
static const char *WIFI_SSID = "your-ssid";
static const char *WIFI_PASS = "your-password";
static const char *AGENT_HOST = "192.168.1.10"; // box running the agent
static const uint16_t AGENT_PORT = FLU_PORT_DEFAULT; // 17996

// openssl rand -hex 16  ->  one byte per pair; MUST match the agent secret
static const uint8_t KEY[16] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
                                0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef};

static const char *SITE = "greenhouse";   // becomes a first-class site pill
static const char *PLUGIN = "m5-env";     // shown as the packet's plugin
static const char *DESCRIPTION = "soil probe";

static const uint32_t HEARTBEAT_MS = 15000; // <=100s keeps liveness glowing
// -------------------------------------------------------------------------

static WiFiUDP udp;
static uint16_t seq = 0;

void setup() {
    Serial.begin(115200);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED) {
        delay(250);
        Serial.print('.');
    }
    Serial.printf("\nwifi up: %s\n", WiFi.localIP().toString().c_str());

    configTime(0, 0, "pool.ntp.org"); // UTC; enables FLU_F_TS once synced
}

void loop() {
    flu_signed_v1 s;
    flu_init(&s.p, SITE, PLUGIN, DESCRIPTION);
    s.p.device_seq = seq++;

    // ship device time only once NTP has produced something plausible;
    // a clockless packet is fine - the agent stamps arrival time
    time_t now = time(nullptr);
    if (now > 1700000000) {
        flu_set_time(&s.p, (uint32_t)now);
    }

    // ---- replace with real sensor reads ----
    char text[41];
    snprintf(text, sizeof text, "uptime %lus", (unsigned long)(millis() / 1000));
    flu_set_field(&s.p, 0, 2, text);
    snprintf(text, sizeof text, "heap %u", (unsigned)ESP.getFreeHeap());
    flu_set_field(&s.p, 1, 7, text);
    // -----------------------------------------

    size_t n = flu_sign(&s, KEY); // sets FLU_F_MAC, fills the trailer (237B)

    udp.beginPacket(AGENT_HOST, AGENT_PORT);
    udp.write((const uint8_t *)&s, n);
    udp.endPacket();

    delay(HEARTBEAT_MS); // fire-and-forget telemetry: no ack, no retry
}
