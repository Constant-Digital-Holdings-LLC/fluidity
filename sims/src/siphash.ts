//SipHash-2-4, 64-bit output: the flu_packet_v1 MAC primitive (UDP-SPEC s4).
//
//This is the one SipHash in the repo - device-side (sim, and the C firmware
//kit in U3) and agent-side share it, because the primitive's ground truth is
//external: the test suite pins all 64 official reference vectors from
//veorq/SipHash (vectors_sip64).
//
//Implemented over 32-bit limbs (a Uint32Array holding v0..v3 as lo/hi pairs)
//rather than BigInt: BigInt allocates a fresh object on every &, ^, <<, +, so
//a single hash churned hundreds of allocations and a load-test microbench
//measured ~16.7us per verify (signed decode capped ~60k/s). The limb form is
//allocation-free past one scratch array and measured ~6x faster (signed
//decode ~370k/s) - it matters because MAC verification sits in the agent's
//hot ingest path. No BigInt literals also keeps it portable to the ES6 client
//target. Pure Uint8Array math - no Node imports (Buffer is a Uint8Array).

export const SIP_KEY_BYTES = 16;
export const SIP_MAC_BYTES = 8;

//state layout: s = [v0lo, v0hi, v1lo, v1hi, v2lo, v2hi, v3lo, v3hi]
//even index = low 32 bits, +1 = high 32 bits. Uint32Array stores mask to
//32 bits automatically, so intermediate overflow needs no explicit & 0xffffffff.

const u32le = (b: Uint8Array, o: number): number =>
    ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;

//s[x..x+1] += s[y..y+1] (64-bit add via a carry out of the low limb)
const add64 = (s: Uint32Array, x: number, y: number): void => {
    const lo = (s[x] ?? 0) + (s[y] ?? 0); //< 2^33, exact in a double
    s[x + 1] = (s[x + 1] ?? 0) + (s[y + 1] ?? 0) + (lo > 0xffffffff ? 1 : 0);
    s[x] = lo;
};

const xor64 = (s: Uint32Array, x: number, y: number): void => {
    s[x] = (s[x] ?? 0) ^ (s[y] ?? 0);
    s[x + 1] = (s[x + 1] ?? 0) ^ (s[y + 1] ?? 0);
};

//rotate the 64-bit value at s[x..x+1] left by n (1..31, or exactly 32)
const rotl64 = (s: Uint32Array, x: number, n: number): void => {
    const l = s[x] ?? 0;
    const h = s[x + 1] ?? 0;
    if (n === 32) {
        s[x] = h;
        s[x + 1] = l;
    } else {
        s[x] = (l << n) | (h >>> (32 - n));
        s[x + 1] = (h << n) | (l >>> (32 - n));
    }
};

const sipround = (s: Uint32Array): void => {
    add64(s, 0, 2); //v0 += v1
    rotl64(s, 2, 13); //v1 = rotl(v1,13)
    xor64(s, 2, 0); //v1 ^= v0
    rotl64(s, 0, 32); //v0 = rotl(v0,32)
    add64(s, 4, 6); //v2 += v3
    rotl64(s, 6, 16); //v3 = rotl(v3,16)
    xor64(s, 6, 4); //v3 ^= v2
    add64(s, 0, 6); //v0 += v3
    rotl64(s, 6, 21); //v3 = rotl(v3,21)
    xor64(s, 6, 0); //v3 ^= v0
    add64(s, 4, 2); //v2 += v1
    rotl64(s, 2, 17); //v1 = rotl(v1,17)
    xor64(s, 2, 4); //v1 ^= v2
    rotl64(s, 4, 32); //v2 = rotl(v2,32)
};

export const siphash24 = (key: Uint8Array, msg: Uint8Array): Uint8Array => {
    if (key.length !== SIP_KEY_BYTES) {
        throw new Error(`siphash24: key must be exactly ${SIP_KEY_BYTES} bytes`);
    }

    const k0l = u32le(key, 0);
    const k0h = u32le(key, 4);
    const k1l = u32le(key, 8);
    const k1h = u32le(key, 12);

    //IV "somepseudorandomlygeneratedbytes" XOR the key halves (k0,k0,k1,k1)
    const s = new Uint32Array(8);
    s[0] = 0x70736575 ^ k0l; //v0  0x736f6d6570736575
    s[1] = 0x736f6d65 ^ k0h;
    s[2] = 0x6e646f6d ^ k1l; //v1  0x646f72616e646f6d
    s[3] = 0x646f7261 ^ k1h;
    s[4] = 0x6e657261 ^ k0l; //v2  0x6c7967656e657261
    s[5] = 0x6c796765 ^ k0h;
    s[6] = 0x79746573 ^ k1l; //v3  0x7465646279746573
    s[7] = 0x74656462 ^ k1h;

    const tail = msg.length & 7;
    const full = msg.length - tail;

    for (let i = 0; i < full; i += 8) {
        const ml = u32le(msg, i);
        const mh = u32le(msg, i + 4);
        s[6] ^= ml;
        s[7] ^= mh;
        sipround(s);
        sipround(s);
        s[0] ^= ml;
        s[1] ^= mh;
    }

    //final block: trailing bytes little-endian, length (mod 256) in the top byte
    let bl = 0;
    let bh = (msg.length & 0xff) << 24;
    for (let i = 0; i < tail; i++) {
        const byte = msg[full + i] ?? 0;
        if (i < 4) bl |= byte << (8 * i);
        else bh |= byte << (8 * (i - 4));
    }
    s[6] ^= bl;
    s[7] ^= bh;
    sipround(s);
    sipround(s);
    s[0] ^= bl;
    s[1] ^= bh;

    s[4] ^= 0xff;
    sipround(s);
    sipround(s);
    sipround(s);
    sipround(s);

    const outl = ((s[0] ?? 0) ^ (s[2] ?? 0) ^ (s[4] ?? 0) ^ (s[6] ?? 0)) >>> 0;
    const outh = ((s[1] ?? 0) ^ (s[3] ?? 0) ^ (s[5] ?? 0) ^ (s[7] ?? 0)) >>> 0;

    const mac = new Uint8Array(SIP_MAC_BYTES);
    mac[0] = outl & 0xff;
    mac[1] = (outl >>> 8) & 0xff;
    mac[2] = (outl >>> 16) & 0xff;
    mac[3] = (outl >>> 24) & 0xff;
    mac[4] = outh & 0xff;
    mac[5] = (outh >>> 8) & 0xff;
    mac[6] = (outh >>> 16) & 0xff;
    mac[7] = (outh >>> 24) & 0xff;
    return mac;
};

//constant-time comparison: a LAN replayer must learn nothing from timing
export const macEqual = (a: Uint8Array, b: Uint8Array): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
};

//config secrets arrive as 32 hex chars (openssl rand -hex 16); null = invalid
export const sipKeyFromHex = (hex: string): Uint8Array | null => {
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
    const key = new Uint8Array(SIP_KEY_BYTES);
    for (let i = 0; i < SIP_KEY_BYTES; i++) {
        key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return key;
};
