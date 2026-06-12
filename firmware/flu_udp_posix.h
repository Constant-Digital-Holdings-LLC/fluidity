#ifndef FLU_UDP_POSIX_H
#define FLU_UDP_POSIX_H

/* getaddrinfo/socket are POSIX, hidden under a strict -std=c11 unless a
   feature-test macro is set. Define it before any system header is pulled in,
   so include THIS header first (it includes fluidity_udp.h for you). */
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200112L
#endif
/*
 * flu_udp_posix.h - POSIX/Linux UDP transport for flu_packet_v1.
 *
 * The companion to fluidity_udp.h for a program running on a normal host (the
 * same box as the agent, or anywhere on its LAN) rather than a microcontroller.
 * fluidity_udp.h packs the wire format; this opens a UDP socket and sends it.
 * C11 + POSIX sockets, no other dependencies.
 *
 *     #include "fluidity_udp.h"
 *     #include "flu_udp_posix.h"
 *
 *     flu_udp_conn c;
 *     if (flu_udp_open(&c, "127.0.0.1", FLU_PORT_DEFAULT) != 0) return 1;  // once
 *
 *     flu_packet_v1 p;
 *     flu_init(&p, "proc-a", "worker", "queue depth");
 *     p.device_seq = seq++;
 *     flu_set_field(&p, 0, 4, "depth 12");
 *     flu_udp_send(&c, &p);                 // fire-and-forget, open mode
 *
 * Same host: pass "127.0.0.1". The socket is connect()ed, so send() is a single
 * syscall and a downed agent surfaces as ECONNREFUSED on send - which you can
 * ignore, the feed is loss-tolerant by design. Heartbeat at least every <=100s
 * so the site's liveness dot stays lit. Open one connection and reuse it.
 *
 * MAC mode: define FLU_ENABLE_MAC before the includes and use
 * flu_udp_send_signed(); the 16-byte key must equal the collector's `secret`.
 */
#include "fluidity_udp.h"

#include <sys/types.h>
#include <sys/socket.h>
#include <netdb.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

typedef struct {
    int fd;
} flu_udp_conn;

/* Open a connected UDP socket to host:port. host may be a numeric IPv4/IPv6
   literal or a name (resolved via getaddrinfo; IPv4 and IPv6 both work).
   Returns 0 on success, -1 on error (errno / the resolver failed). */
static inline int flu_udp_open(flu_udp_conn *c, const char *host, uint16_t port) {
    char portstr[6];
    struct addrinfo hints;
    struct addrinfo *res = NULL;
    struct addrinfo *ai;
    int fd = -1;

    c->fd = -1;
    snprintf(portstr, sizeof portstr, "%u", (unsigned)port);

    memset(&hints, 0, sizeof hints);
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_DGRAM;
    if (getaddrinfo(host ? host : "127.0.0.1", portstr, &hints, &res) != 0) return -1;

    for (ai = res; ai != NULL; ai = ai->ai_next) {
        fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        if (connect(fd, ai->ai_addr, ai->ai_addrlen) == 0) break;
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    if (fd < 0) return -1;

    c->fd = fd;
    return 0;
}

/* Publish an unsigned packet (open mode). Returns bytes sent, or -1 (errno). */
static inline ssize_t flu_udp_send(const flu_udp_conn *c, const flu_packet_v1 *p) {
    return send(c->fd, p, flu_wire_size(p), 0);
}

#ifdef FLU_ENABLE_MAC
/* Sign (in place) and publish a packet (MAC mode). The key must equal the
   collector's `secret`. Returns bytes sent (237), or -1 (errno). */
static inline ssize_t flu_udp_send_signed(const flu_udp_conn *c, flu_signed_v1 *s, const uint8_t key[16]) {
    size_t n = flu_sign(s, key);
    return send(c->fd, s, n, 0);
}
#endif

static inline void flu_udp_close(flu_udp_conn *c) {
    if (c->fd >= 0) {
        close(c->fd);
        c->fd = -1;
    }
}

#endif /* FLU_UDP_POSIX_H */
