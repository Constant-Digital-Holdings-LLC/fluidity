export const SIP_KEY_BYTES = 16;
export const SIP_MAC_BYTES = 8;
const u32le = (b, o) => ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
const add64 = (s, x, y) => {
    const lo = (s[x] ?? 0) + (s[y] ?? 0);
    s[x + 1] = (s[x + 1] ?? 0) + (s[y + 1] ?? 0) + (lo > 0xffffffff ? 1 : 0);
    s[x] = lo;
};
const xor64 = (s, x, y) => {
    s[x] = (s[x] ?? 0) ^ (s[y] ?? 0);
    s[x + 1] = (s[x + 1] ?? 0) ^ (s[y + 1] ?? 0);
};
const rotl64 = (s, x, n) => {
    const l = s[x] ?? 0;
    const h = s[x + 1] ?? 0;
    if (n === 32) {
        s[x] = h;
        s[x + 1] = l;
    }
    else {
        s[x] = (l << n) | (h >>> (32 - n));
        s[x + 1] = (h << n) | (l >>> (32 - n));
    }
};
const sipround = (s) => {
    add64(s, 0, 2);
    rotl64(s, 2, 13);
    xor64(s, 2, 0);
    rotl64(s, 0, 32);
    add64(s, 4, 6);
    rotl64(s, 6, 16);
    xor64(s, 6, 4);
    add64(s, 0, 6);
    rotl64(s, 6, 21);
    xor64(s, 6, 0);
    add64(s, 4, 2);
    rotl64(s, 2, 17);
    xor64(s, 2, 4);
    rotl64(s, 4, 32);
};
export const siphash24 = (key, msg) => {
    if (key.length !== SIP_KEY_BYTES) {
        throw new Error(`siphash24: key must be exactly ${SIP_KEY_BYTES} bytes`);
    }
    const k0l = u32le(key, 0);
    const k0h = u32le(key, 4);
    const k1l = u32le(key, 8);
    const k1h = u32le(key, 12);
    const s = new Uint32Array(8);
    s[0] = 0x70736575 ^ k0l;
    s[1] = 0x736f6d65 ^ k0h;
    s[2] = 0x6e646f6d ^ k1l;
    s[3] = 0x646f7261 ^ k1h;
    s[4] = 0x6e657261 ^ k0l;
    s[5] = 0x6c796765 ^ k0h;
    s[6] = 0x79746573 ^ k1l;
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
    let bl = 0;
    let bh = (msg.length & 0xff) << 24;
    for (let i = 0; i < tail; i++) {
        const byte = msg[full + i] ?? 0;
        if (i < 4)
            bl |= byte << (8 * i);
        else
            bh |= byte << (8 * (i - 4));
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
export const macEqual = (a, b) => {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
};
export const sipKeyFromHex = (hex) => {
    if (!/^[0-9a-fA-F]{32}$/.test(hex))
        return null;
    const key = new Uint8Array(SIP_KEY_BYTES);
    for (let i = 0; i < SIP_KEY_BYTES; i++) {
        key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return key;
};
//# sourceMappingURL=siphash.js.map