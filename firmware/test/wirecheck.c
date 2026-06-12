/*
 * wirecheck.c - host-compiled proof that fluidity_udp.h emits the wire
 * format byte-for-byte. service/src/agent/tests/udpFirmware.test.ts
 * compiles this with the system compiler, runs both modes, and compares
 * every byte against the TypeScript implementations (agent codec and sim
 * packer) - three independent implementations of UDP-SPEC s3 must agree.
 *
 *   wirecheck vectors  -> 64 lines: SipHash-2-4 MACs for the official
 *                         test-vector inputs (key 000102..0f, msg 00..i-1)
 *   wirecheck packets  -> labeled datagrams, "label hex" per line
 */
#define FLU_ENABLE_MAC
#include "../fluidity_udp.h"
#include <stdio.h>
#include <string.h>

static void print_hex(const uint8_t *b, size_t n) {
    size_t i;
    for (i = 0; i < n; i++) printf("%02x", b[i]);
    putchar('\n');
}

static void vectors(void) {
    uint8_t key[16], msg[64], mac[8];
    int i, len;
    for (i = 0; i < 16; i++) key[i] = (uint8_t)i;
    for (i = 0; i < 64; i++) msg[i] = (uint8_t)i;
    for (len = 0; len < 64; len++) {
        flu_siphash24(key, msg, (size_t)len, mac);
        print_hex(mac, sizeof mac);
    }
}

static void packets(void) {
    flu_packet_v1 p;
    flu_signed_v1 s;
    uint8_t key[16];
    size_t n;
    int i;

    flu_init(&p, "greenhouse", "m5-env", "soil probe");
    p.device_seq = 4242;
    flu_set_field(&p, 0, 2, "temp 21.4C");
    flu_set_field(&p, 1, 7, "rh 64%");

    printf("open-compact ");
    print_hex((const uint8_t *)&p, flu_wire_size(&p));
    printf("open-full ");
    print_hex((const uint8_t *)&p, sizeof p);

    flu_set_time(&p, 1765000000u);
    printf("timestamped ");
    print_hex((const uint8_t *)&p, flu_wire_size(&p));

    flu_init(&s.p, "gate-1", "avr-door", "driveway");
    s.p.device_seq = 7;
    flu_set_field(&s.p, 0, 10, "closed");
    for (i = 0; i < 16; i++) key[i] = (uint8_t)(0xa0 + i);
    n = flu_sign(&s, key);
    printf("signed ");
    print_hex((const uint8_t *)&s, n);

    /* silent truncation is part of the firmware contract (strncpy
       semantics); the sim packer must agree byte-for-byte */
    flu_init(&p, "seventeen-bytes-x", "p", "");
    p.device_seq = 1;
    flu_set_field(&p, 0, 0, "x");
    printf("truncated-site ");
    print_hex((const uint8_t *)&p, flu_wire_size(&p));
}

int main(int argc, char **argv) {
    if (argc > 1 && strcmp(argv[1], "vectors") == 0) {
        vectors();
        return 0;
    }
    if (argc > 1 && strcmp(argv[1], "packets") == 0) {
        packets();
        return 0;
    }
    fprintf(stderr, "usage: %s vectors|packets\n", argv[0]);
    return 2;
}
