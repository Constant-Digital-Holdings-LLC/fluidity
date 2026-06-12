# fluidity_udp.py - flu_packet_v1 publisher for MicroPython / CircuitPython
#
# Pure packing + SipHash-2-4 signing, no networking and no dependencies, so
# the same module runs on MicroPython (Pico W, ESP32) and CircuitPython - only
# the socket calls in your main differ (see main.py). The wire format is
# normative in service/UDP-SPEC.md (s3); this is a fourth independent
# implementation of it, pinned byte-for-byte against the C header, the agent
# decoder, and the TypeScript sim by the test suite.
#
#     import fluidity_udp as flu
#     pkt = flu.build_packet("greenhouse", "pico-env", "soil probe",
#                            [(2, "temp 21.4C"), (10, "ok")], seq)
#     sock.sendto(pkt, (agent_host, flu.PORT_DEFAULT))   # open mode, compact
#
#     # MAC mode (UDP-SPEC s4): key must equal the agent's `secret`
#     pkt = flu.sign(flu.build_packet(..., full=True), key16)
#     sock.sendto(pkt, (agent_host, flu.PORT_DEFAULT))   # signed, full struct
#
# Heartbeat: send at least one packet every <=100s so the site's liveness dot
# on the dashboards glows on the same cadence as every other Fluidity source.

try:
    import ustruct as struct
except ImportError:  # CPython / CircuitPython
    import struct

MAGIC = 0x31554C46  # "FLU1" read little-endian
VERSION = 1
F_TS = 0x01
F_MAC = 0x02
MAX_FIELDS = 4
HEADER_BYTES = 61  # through field_count
FIELD_BYTES = 42  # style + reserved + text[40]
FIELD_TEXT = 40
NAME_BYTES = 16  # site / plugin / description
FULL_BYTES = HEADER_BYTES + MAX_FIELDS * FIELD_BYTES  # 229
MAC_BYTES = 8
PORT_DEFAULT = 17996  # 0x464C, "FL"


def _name(buf, off, width, text):
    # NUL-padded UTF-8, truncated to the field width (strncpy semantics, like
    # the firmware). Keep multibyte chars whole to avoid a wasted datagram.
    raw = text.encode("utf-8")[:width]
    while raw and (raw[-1] & 0xC0) == 0x80 and not _is_complete(raw):
        raw = raw[:-1]
    buf[off : off + len(raw)] = raw
    # the bytearray is pre-zeroed, so the remainder is already NUL padding


def _is_complete(raw):
    # does `raw` end on a whole UTF-8 sequence? (cheap check: try to decode)
    try:
        raw.decode("utf-8")
        return True
    except Exception:
        return False


def build_packet(site, plugin, description, fields, device_seq, ts_epoch=None, full=False):
    """Build a flu_packet_v1 datagram (without a MAC trailer).

    fields: list of (style, text) tuples, 1..4. style 0..10 maps to the
    dashboard palette; >=100 means trim + color (style % 10).
    ts_epoch: unix seconds (UTC) if the device has a real clock; else None and
    the agent stamps arrival time. full=True emits the 229-byte struct (use it
    before sign()); otherwise the compact 61 + 42*len(fields) form.
    """
    n = len(fields)
    if n < 1 or n > MAX_FIELDS:
        raise ValueError("fields must be 1..%d" % MAX_FIELDS)

    count = MAX_FIELDS if full else n
    buf = bytearray(HEADER_BYTES + count * FIELD_BYTES)

    struct.pack_into("<I", buf, 0, MAGIC)
    buf[4] = VERSION
    buf[5] = F_TS if ts_epoch is not None else 0
    struct.pack_into("<H", buf, 6, device_seq & 0xFFFF)
    struct.pack_into("<I", buf, 8, int(ts_epoch) & 0xFFFFFFFF if ts_epoch is not None else 0)
    _name(buf, 12, NAME_BYTES, site)
    _name(buf, 28, NAME_BYTES, plugin)
    _name(buf, 44, NAME_BYTES, description)
    buf[60] = n  # field_count is the LOGICAL count even in the full form

    for i, (style, text) in enumerate(fields):
        base = HEADER_BYTES + i * FIELD_BYTES
        buf[base] = style & 0xFF
        # buf[base + 1] reserved, stays 0
        _name(buf, base + 2, FIELD_TEXT, text)

    return buf


def _rotl(x, b):
    return ((x << b) | (x >> (64 - b))) & 0xFFFFFFFFFFFFFFFF


def siphash24(key, msg):
    """SipHash-2-4, 16-byte key -> 8-byte little-endian MAC."""
    k0 = struct.unpack("<Q", bytes(key[0:8]))[0]
    k1 = struct.unpack("<Q", bytes(key[8:16]))[0]
    v0 = k0 ^ 0x736F6D6570736575
    v1 = k1 ^ 0x646F72616E646F6D
    v2 = k0 ^ 0x6C7967656E657261
    v3 = k1 ^ 0x7465646279746573

    def rounds(n):
        nonlocal v0, v1, v2, v3
        for _ in range(n):
            v0 = (v0 + v1) & 0xFFFFFFFFFFFFFFFF
            v1 = _rotl(v1, 13) ^ v0
            v0 = _rotl(v0, 32)
            v2 = (v2 + v3) & 0xFFFFFFFFFFFFFFFF
            v3 = _rotl(v3, 16) ^ v2
            v0 = (v0 + v3) & 0xFFFFFFFFFFFFFFFF
            v3 = _rotl(v3, 21) ^ v0
            v2 = (v2 + v1) & 0xFFFFFFFFFFFFFFFF
            v1 = _rotl(v1, 17) ^ v2
            v2 = _rotl(v2, 32)

    msg = bytes(msg)
    length = len(msg)
    end = length - (length % 8)
    for off in range(0, end, 8):
        m = struct.unpack("<Q", msg[off : off + 8])[0]
        v3 ^= m
        rounds(2)
        v0 ^= m

    # final block: trailing bytes + length in the top byte
    b = (length & 0xFF) << 56
    for i in range(length - end):
        b |= msg[end + i] << (8 * i)
    v3 ^= b
    rounds(2)
    v0 ^= b

    v2 ^= 0xFF
    rounds(4)
    return struct.pack("<Q", v0 ^ v1 ^ v2 ^ v3)


def sign(struct_bytes, key):
    """Set FLU_F_MAC and append the SipHash-2-4 trailer over the flagged bytes.

    Pass a full-struct packet (build_packet(..., full=True)); the trailer must
    sit immediately after the signed bytes. Matches the agent's verify path.
    """
    signed = bytearray(struct_bytes)
    signed[5] |= F_MAC
    return bytes(signed) + siphash24(key, signed)


def key_from_hex(hex_str):
    """Parse the 32-hex-char agent `secret` into a 16-byte key."""
    if len(hex_str) != 32:
        raise ValueError("secret must be exactly 32 hex chars (16 bytes)")
    return bytes(int(hex_str[i : i + 2], 16) for i in range(0, 32, 2))
