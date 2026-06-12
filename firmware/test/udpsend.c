/*
 * udpsend.c - one-shot flu_packet_v1 emitter over real UDP, used by
 * udpPosix.test.ts to prove a C program reaches the agent's udpStruct
 * collector end-to-end (and to pin flu_udp_posix.h). Sends exactly one packet
 * and exits. Open mode by default; signed (MAC mode) when a secret is given.
 *
 *     udpsend <host> <port> [secret-hex32]
 */
#define FLU_ENABLE_MAC
#include "../flu_udp_posix.h" /* includes fluidity_udp.h (which sees FLU_ENABLE_MAC) */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int hex2key(const char *hex, uint8_t key[16]) {
    if (strlen(hex) != 32) return -1;
    for (int i = 0; i < 16; i++) {
        unsigned b;
        if (sscanf(hex + 2 * i, "%2x", &b) != 1) return -1;
        key[i] = (uint8_t)b;
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <host> <port> [secret-hex32]\n", argv[0]);
        return 2;
    }

    flu_udp_conn c;
    if (flu_udp_open(&c, argv[1], (uint16_t)atoi(argv[2])) != 0) {
        perror("flu_udp_open");
        return 1;
    }

    flu_packet_v1 p;
    flu_init(&p, "proc-a", "posix-c", "worker telemetry");
    p.device_seq = 1;
    flu_set_field(&p, 0, 4, "depth 12");
    flu_set_field(&p, 1, 10, "ok");

    ssize_t sent;
    if (argc >= 4) {
        uint8_t key[16];
        if (hex2key(argv[3], key) != 0) {
            fprintf(stderr, "secret must be 32 hex chars\n");
            return 2;
        }
        flu_signed_v1 s;
        s.p = p;
        sent = flu_udp_send_signed(&c, &s, key);
    } else {
        sent = flu_udp_send(&c, &p);
    }
    flu_udp_close(&c);

    if (sent < 0) {
        perror("send");
        return 1;
    }
    return 0;
}
