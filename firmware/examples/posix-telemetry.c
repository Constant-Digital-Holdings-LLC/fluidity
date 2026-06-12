/*
 * posix-telemetry.c - a long-running C program publishing telemetry into a
 * local Fluidity agent over UDP. Copy this pattern into your program.
 *
 * Build (from the firmware/ dir):
 *     cc -std=c11 -Wall -Wextra -O2 -o posix-telemetry examples/posix-telemetry.c
 *
 * The agent needs a udpStruct collector listening (the default port is 17996):
 *     { "plugin": "udpStruct", "port": 17996, "bind": "127.0.0.1" }
 *
 * Same host as the agent -> "127.0.0.1". Each program names its own `site`, so
 * the two programs show up as two first-class sites on the dashboards.
 */
#include "../flu_udp_posix.h" /* includes fluidity_udp.h; sets the POSIX macro first */

#include <stdio.h>
#include <unistd.h>

int main(void) {
    flu_udp_conn c;
    if (flu_udp_open(&c, "127.0.0.1", FLU_PORT_DEFAULT) != 0) {
        perror("flu_udp_open");
        return 1;
    }

    uint16_t seq = 0; /* monotonic per process; 16-bit wrap is fine */
    for (;;) {
        flu_packet_v1 p;
        flu_init(&p, "proc-a", "worker", "queue depth");
        p.device_seq = seq++;

        char depth[40];
        snprintf(depth, sizeof depth, "depth %u", (unsigned)(seq % 100));
        flu_set_field(&p, 0, 4, depth);    /* style 4 = a metric tone */
        flu_set_field(&p, 1, 10, "ok");    /* style 10 = the quiet tone */

        /* fire-and-forget: a downed agent gives ECONNREFUSED, which we ignore
           - the feed is loss-tolerant and the next send will reconnect-route */
        flu_udp_send(&c, &p);

        sleep(5); /* heartbeat <=100s keeps the site's liveness dot glowing */
    }

    /* not reached; on a real shutdown path: flu_udp_close(&c); */
}

/*
 * MAC mode (untrusted segment): define FLU_ENABLE_MAC before the includes,
 * give the agent collector a matching `secret`
 *   { "plugin":"udpStruct", "port":17996, "extendedOptions":{ "secret":"<hex32>", "requireMac":true } }
 * and publish with:
 *
 *     static const uint8_t KEY[16] = { ... };   // openssl rand -hex 16
 *     flu_signed_v1 s;
 *     flu_init(&s.p, "proc-a", "worker", "queue depth");
 *     s.p.device_seq = seq++;
 *     flu_set_field(&s.p, 0, 4, depth);
 *     flu_udp_send_signed(&c, &s, KEY);
 *
 * On a trusted local host the open mode above is the right, simplest choice.
 */
