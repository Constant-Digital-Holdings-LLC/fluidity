/*
  SRS controller serial telemetry simulator (v2)

  Emulates the unsolicited telemetry of a Sierra Radio Systems HamStack
  controller, per SRS Command List 0152, command C22A:

    bit 3 - receive/transmit status streaming: "[cc pp rr dd tt]\r\n"
            five hex bytes = per-port bitmasks for COR, PL, qualified
            receive, DTMF, PTT. Sent every 100 seconds and on state change.
    bit 4 - port status streaming: "{ll oo dd ss gg ii}\r\n"
            LINK, LOOPBACK, DISABLED, SUDISABLED, SPLIT_GROUP, INTERFACED.
            Sent every 100 seconds (and when a command executes).

  Behavior tuned against production captures from https://f-y.io:
  single-port COR events alternating between two ports of a linked system
  ("overs" in a QSO), an all-zero frame streamed on each release, and a
  constant per-site port-state signature with LINK a subset of INTERFACED.

  Replaces the v1 sketch that replayed a fixed frame table.
*/

// port-state signature: {0f 01 00 00 00 1f} (matches an observed real site)
const uint8_t LINKED = 0x0f;
const uint8_t LOOPBACK = 0x01;
const uint8_t INTERFACED = 0x1f;

// ports that carry simulated traffic (bit numbers)
const uint8_t ACTIVE_PORTS[] = { 0, 6 };
const uint8_t NUM_ACTIVE = sizeof(ACTIVE_PORTS);

const unsigned long HEARTBEAT_MS = 100000UL;

uint8_t cor = 0;
uint8_t rcvact = 0;

bool keyed = false;
int oversLeft = 0;
int portIdx = 0;

unsigned long nextRadioHb;
unsigned long nextPortHb;
unsigned long nextQsoEvent;

void emitRadioFrame() {
  char buf[18];
  sprintf(buf, "[%02x %02x %02x %02x %02x]", cor, 0, rcvact, 0, 0);
  Serial.print(buf);
  Serial.print("\r\n");
}

void emitPortFrame() {
  char buf[22];
  sprintf(buf, "{%02x %02x %02x %02x %02x %02x}", LINKED, LOOPBACK, 0, 0, 0, INTERFACED);
  Serial.print(buf);
  Serial.print("\r\n");
}

void setup() {
  Serial.begin(9600);
  // while the serial stream is not open, do nothing:
  while (!Serial) ;

  randomSeed(analogRead(0));

  unsigned long now = millis();
  nextRadioHb = now + HEARTBEAT_MS;
  nextPortHb = now + random(2000, 10000);   // show port states soon after connect
  nextQsoEvent = now + random(2000, 20000);
}

void loop() {
  unsigned long now = millis();

  // 100 second heartbeats (current state, even if all zeros)
  if ((long)(now - nextRadioHb) >= 0) {
    emitRadioFrame();
    nextRadioHb += HEARTBEAT_MS;
  }

  if ((long)(now - nextPortHb) >= 0) {
    emitPortFrame();
    nextPortHb += HEARTBEAT_MS;
  }

  // QSO state machine: alternating overs between active ports
  if ((long)(now - nextQsoEvent) >= 0) {
    if (!keyed) {
      // key up (start of an over, possibly of a new QSO)
      if (oversLeft == 0) {
        oversLeft = random(2, 9);
        portIdx = random(0, NUM_ACTIVE);
      }
      uint8_t port = ACTIVE_PORTS[portIdx % NUM_ACTIVE];
      cor = (uint8_t)(1 << port);
      rcvact = (random(0, 10) == 0) ? cor : 0;   // occasional qualified-receive
      keyed = true;
      emitRadioFrame();
      nextQsoEvent = now + random(800, 8001);    // key-down duration
    } else {
      // key release: the state change to zero is streamed too
      cor = 0;
      rcvact = 0;
      keyed = false;
      oversLeft--;
      portIdx++;
      emitRadioFrame();
      nextQsoEvent = now + (oversLeft > 0 ? random(400, 4001)        // gap between overs
                                          : random(15000, 180001));  // idle between QSOs
    }
  }

  delay(10);
}
