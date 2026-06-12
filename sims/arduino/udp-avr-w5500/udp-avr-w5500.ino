/*
  Fluidity flu_packet_v1 publisher - classic Arduino / AVR + W5500 (or
  W5100) Ethernet shield

  Open mode (UDP-SPEC s4): no MAC, suitable for a trusted LAN - the agent
  stanza is just { "plugin": "udpStruct", "port": 17996 }. The compact wire
  form (61 + 42 x fields bytes) keeps datagrams tiny; the 229-byte struct
  lives comfortably on a 2KB Uno's stack.

  A door contact on pin 2 (closed to GND, INPUT_PULLUP) publishes
  immediately on change and heartbeats every 20s regardless - the same
  shape as the gate-1 device in the software sim, down to the styles:
  5 (OPEN, an event) and 10 (closed, the quiet tone).

  Setup: copy firmware/fluidity_udp.h from the Fluidity repo into this
  sketch folder, set the addresses below, wire pin 2, flash.
*/

#include "fluidity_udp.h"
#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>

// ---- configure me -------------------------------------------------------
static byte MAC[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01}; // unique per board
static const IPAddress FALLBACK_IP(192, 168, 1, 177);     // if DHCP fails
static const IPAddress AGENT_IP(192, 168, 1, 10);
static const uint16_t AGENT_PORT = FLU_PORT_DEFAULT; // 17996

static const char *SITE = "gate-1";
static const char *PLUGIN = "avr-door";
static const char *DESCRIPTION = "driveway";

static const uint8_t DOOR_PIN = 2;            // contact to GND, pullup on
static const unsigned long HEARTBEAT_MS = 20000UL;
// -------------------------------------------------------------------------

static EthernetUDP udp;
static uint16_t seq = 0;
static int lastDoor = -1;
static unsigned long lastSend = 0;

static void publish(int doorOpen) {
    flu_packet_v1 p;
    flu_init(&p, SITE, PLUGIN, DESCRIPTION);
    p.device_seq = seq++;
    // style 5 = event color, style 10 = the palette's quiet tone
    flu_set_field(&p, 0, doorOpen ? 5 : 10, doorOpen ? "OPEN" : "closed");

    udp.beginPacket(AGENT_IP, AGENT_PORT);
    udp.write((const uint8_t *)&p, flu_wire_size(&p)); // compact form
    udp.endPacket();

    lastSend = millis();
}

void setup() {
    pinMode(DOOR_PIN, INPUT_PULLUP);

    if (Ethernet.begin(MAC) == 0) {  // DHCP first
        Ethernet.begin(MAC, FALLBACK_IP);
    }
    udp.begin(49152); // local source port; the agent only cares about 17996
}

void loop() {
    int doorOpen = (digitalRead(DOOR_PIN) == HIGH) ? 1 : 0;

    // event: state change publishes immediately; heartbeat: every 20s the
    // current state goes out anyway, so the site's liveness dot stays fresh
    if (doorOpen != lastDoor || (millis() - lastSend) >= HEARTBEAT_MS) {
        lastDoor = doorOpen;
        publish(doorOpen);
    }

    delay(50); // crude debounce; fine for a gate contact
}
