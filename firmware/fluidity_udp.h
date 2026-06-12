/*
 * fluidity_udp.h - flu_packet_v1 publisher kit for microcontrollers
 *
 * Single header, C99/C11 and Arduino C++, no dependencies. The wire format
 * is normative in service/UDP-SPEC.md (s3); this header IS that struct, so
 * publishing is:
 *
 *     flu_packet_v1 p;
 *     flu_init(&p, "greenhouse", "m5-env", "soil probe");
 *     p.device_seq = seq++;
 *     flu_set_field(&p, 0, 2, "temp 21.4C");
 *     sendto(sock, &p, flu_wire_size(&p), ...);        // compact form
 *
 * MAC mode (UDP-SPEC s4) - define FLU_ENABLE_MAC before including:
 *
 *     flu_signed_v1 s;
 *     flu_init(&s.p, "gate-1", "avr-door", "driveway");
 *     s.p.device_seq = seq++;
 *     flu_set_field(&s.p, 0, 10, "closed");
 *     size_t n = flu_sign(&s, key16);                  // full struct + trailer
 *     sendto(sock, &s, n, ...);
 *
 * Signed datagrams always use the full-struct form (sizeof + 8 = 237 bytes):
 * the trailer must sit immediately after the signed bytes, and a fixed-size
 * send keeps the firmware trivial. The agent accepts both forms.
 *
 * Heartbeat guidance: send at least one packet every <=100s so the site's
 * liveness indicator on the dashboards glows/fades on the same cadence as
 * every other Fluidity source.
 *
 * The wire is little-endian; every supported target (AVR, ESP32, ARM
 * Cortex-M, x86 test hosts) is little-endian, and this header refuses to
 * compile on a big-endian target rather than emit byte-swapped packets.
 */

#ifndef FLUIDITY_UDP_H
#define FLUIDITY_UDP_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
#error "flu_packet_v1 is little-endian on the wire; this target is big-endian"
#endif

#define FLU_MAGIC 0x31554C46u /* bytes "FLU1" on the wire */
#define FLU_VERSION 1
#define FLU_MAX_FIELDS 4

#define FLU_F_TS 0x01  /* ts_epoch carries valid device time (unix UTC) */
#define FLU_F_MAC 0x02 /* SipHash-2-4 trailer follows the struct */

#define FLU_PORT_DEFAULT 17996 /* 0x464C, "FL" */

#if defined(_MSC_VER)
#pragma pack(push, 1)
#define FLU_PACKED
#else
#define FLU_PACKED __attribute__((packed))
#endif

typedef struct FLU_PACKED {
    uint32_t magic;   /* FLU_MAGIC */
    uint8_t version;  /* FLU_VERSION */
    uint8_t flags;    /* FLU_F_* */
    uint16_t device_seq; /* monotonic, wraps; 0 allowed */
    uint32_t ts_epoch;   /* unix seconds UTC; ignored unless FLU_F_TS */
    char site[16];       /* NUL-padded UTF-8 */
    char plugin[16];     /* e.g. "m5-env", "avr-door" */
    char description[16];
    uint8_t field_count; /* 1..FLU_MAX_FIELDS */
    struct FLU_PACKED {
        uint8_t style;    /* suggestStyle 0..10, or >=100 (trim) */
        uint8_t reserved; /* 0 (fieldType STRING implied in v1) */
        char text[40];    /* NUL-padded UTF-8 */
    } fields[FLU_MAX_FIELDS];
} flu_packet_v1;

typedef struct FLU_PACKED {
    flu_packet_v1 p;
    uint8_t mac[8]; /* SipHash-2-4 over all of p, FLU_F_MAC set first */
} flu_signed_v1;

#if defined(_MSC_VER)
#pragma pack(pop)
#endif

/* the struct IS the wire format - pin every offset at compile time */
#if defined(__cplusplus)
#define FLU_STATIC_ASSERT(c, m) static_assert(c, m)
#elif defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
#define FLU_STATIC_ASSERT(c, m) _Static_assert(c, m)
#else
#define FLU_STATIC_ASSERT(c, m) /* pre-C11: trust, then verify on the host */
#endif

FLU_STATIC_ASSERT(sizeof(flu_packet_v1) == 229, "flu_packet_v1 must pack to 229 bytes");
FLU_STATIC_ASSERT(sizeof(flu_signed_v1) == 237, "flu_signed_v1 must pack to 237 bytes");
#if !defined(__cplusplus) || defined(offsetof)
FLU_STATIC_ASSERT(offsetof(flu_packet_v1, device_seq) == 6, "device_seq at offset 6");
FLU_STATIC_ASSERT(offsetof(flu_packet_v1, ts_epoch) == 8, "ts_epoch at offset 8");
FLU_STATIC_ASSERT(offsetof(flu_packet_v1, site) == 12, "site at offset 12");
FLU_STATIC_ASSERT(offsetof(flu_packet_v1, plugin) == 28, "plugin at offset 28");
FLU_STATIC_ASSERT(offsetof(flu_packet_v1, description) == 44, "description at offset 44");
FLU_STATIC_ASSERT(offsetof(flu_packet_v1, field_count) == 60, "field_count at offset 60");
FLU_STATIC_ASSERT(offsetof(flu_packet_v1, fields) == 61, "fields at offset 61");
#endif

/* bounded copy, NUL-padded to the full width (stale buffer bytes must never
   leak onto the wire); silently truncates like strncpy, by design */
static inline void flu__copy(char *dst, size_t cap, const char *src) {
    size_t i = 0;
    if (src) {
        for (; i < cap && src[i] != '\0'; i++) dst[i] = src[i];
    }
    for (; i < cap; i++) dst[i] = '\0';
}

/* zero the packet and stamp identity; set device_seq (and optionally time)
   yourself, then add 1..4 fields */
static inline void flu_init(flu_packet_v1 *p, const char *site, const char *plugin, const char *description) {
    memset(p, 0, sizeof *p);
    p->magic = FLU_MAGIC;
    p->version = FLU_VERSION;
    flu__copy(p->site, sizeof p->site, site);
    flu__copy(p->plugin, sizeof p->plugin, plugin);
    flu__copy(p->description, sizeof p->description, description);
}

/* returns 0, or -1 if idx is out of range; field_count tracks the highest
   index set */
static inline int flu_set_field(flu_packet_v1 *p, uint8_t idx, uint8_t style, const char *text) {
    if (idx >= FLU_MAX_FIELDS) return -1;
    p->fields[idx].style = style;
    p->fields[idx].reserved = 0;
    flu__copy(p->fields[idx].text, sizeof p->fields[idx].text, text);
    if (p->field_count < (uint8_t)(idx + 1)) p->field_count = (uint8_t)(idx + 1);
    return 0;
}

/* only call with real UTC time (e.g. after NTP sync); without this the
   agent stamps arrival time, which is the right default for clockless
   devices - and the agent ignores device time more than +-24h off anyway */
static inline void flu_set_time(flu_packet_v1 *p, uint32_t epoch_utc) {
    p->ts_epoch = epoch_utc;
    p->flags |= (uint8_t)FLU_F_TS;
}

/* bytes to send for the compact (unsigned) form: 61 + 42 * field_count.
   Sending sizeof(*p) (the full struct) is equally valid. */
static inline size_t flu_wire_size(const flu_packet_v1 *p) {
    return 61u + 42u * (size_t)p->field_count;
}

#ifdef FLU_ENABLE_MAC
/*
 * SipHash-2-4, 64-bit output - reference algorithm by Aumasson & Bernstein
 * (public domain lineage). ~40 lines, fast even on an 8-bit AVR, and pinned
 * to the official test vectors by the repo's host-compiled test suite.
 */
static inline uint64_t flu__rotl64(uint64_t x, int b) {
    return (uint64_t)((x << b) | (x >> (64 - b)));
}

static inline uint64_t flu__u64le(const uint8_t *b) {
    return (uint64_t)b[0] | ((uint64_t)b[1] << 8) | ((uint64_t)b[2] << 16) | ((uint64_t)b[3] << 24) |
           ((uint64_t)b[4] << 32) | ((uint64_t)b[5] << 40) | ((uint64_t)b[6] << 48) | ((uint64_t)b[7] << 56);
}

#define FLU__SIPROUND()                  \
    do {                                 \
        v0 += v1;                        \
        v1 = flu__rotl64(v1, 13);        \
        v1 ^= v0;                        \
        v0 = flu__rotl64(v0, 32);        \
        v2 += v3;                        \
        v3 = flu__rotl64(v3, 16);        \
        v3 ^= v2;                        \
        v0 += v3;                        \
        v3 = flu__rotl64(v3, 21);        \
        v3 ^= v0;                        \
        v2 += v1;                        \
        v1 = flu__rotl64(v1, 17);        \
        v1 ^= v2;                        \
        v2 = flu__rotl64(v2, 32);        \
    } while (0)

static inline void flu_siphash24(const uint8_t key[16], const uint8_t *msg, size_t len, uint8_t out[8]) {
    uint64_t k0 = flu__u64le(key);
    uint64_t k1 = flu__u64le(key + 8);
    uint64_t v0 = 0x736f6d6570736575ULL ^ k0;
    uint64_t v1 = 0x646f72616e646f6dULL ^ k1;
    uint64_t v2 = 0x6c7967656e657261ULL ^ k0;
    uint64_t v3 = 0x7465646279746573ULL ^ k1;
    uint64_t m, b;
    size_t i;
    const size_t full = len & ~(size_t)7;

    for (i = 0; i < full; i += 8) {
        m = flu__u64le(msg + i);
        v3 ^= m;
        FLU__SIPROUND();
        FLU__SIPROUND();
        v0 ^= m;
    }

    b = (uint64_t)(len & 0xff) << 56;
    for (i = full; i < len; i++) {
        b |= (uint64_t)msg[i] << (8 * (i - full));
    }
    v3 ^= b;
    FLU__SIPROUND();
    FLU__SIPROUND();
    v0 ^= b;

    v2 ^= 0xff;
    FLU__SIPROUND();
    FLU__SIPROUND();
    FLU__SIPROUND();
    FLU__SIPROUND();

    b = v0 ^ v1 ^ v2 ^ v3;
    for (i = 0; i < 8; i++) out[i] = (uint8_t)(b >> (8 * i));
}

/* sign for MAC mode: sets FLU_F_MAC (the flag is covered by the MAC), hashes
   the whole struct, fills the trailer. Returns the bytes to send (237). */
static inline size_t flu_sign(flu_signed_v1 *s, const uint8_t key[16]) {
    s->p.flags |= (uint8_t)FLU_F_MAC;
    flu_siphash24(key, (const uint8_t *)&s->p, sizeof s->p, s->mac);
    return sizeof *s;
}
#endif /* FLU_ENABLE_MAC */

#endif /* FLUIDITY_UDP_H */
