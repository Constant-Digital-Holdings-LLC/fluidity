const MASK64 = 0xffffffffffffffffn;
export const SIP_KEY_BYTES = 16;
export const SIP_MAC_BYTES = 8;
const rotl = (x, b) => ((x << b) | (x >> (64n - b))) & MASK64;
export const siphash24 = (key, msg) => {
    if (key.length !== SIP_KEY_BYTES) {
        throw new Error(`siphash24: key must be exactly ${SIP_KEY_BYTES} bytes`);
    }
    const kv = new DataView(key.buffer, key.byteOffset, key.byteLength);
    const k0 = kv.getBigUint64(0, true);
    const k1 = kv.getBigUint64(8, true);
    let v0 = 0x736f6d6570736575n ^ k0;
    let v1 = 0x646f72616e646f6dn ^ k1;
    let v2 = 0x6c7967656e657261n ^ k0;
    let v3 = 0x7465646279746573n ^ k1;
    const sipround = () => {
        v0 = (v0 + v1) & MASK64;
        v1 = rotl(v1, 13n);
        v1 ^= v0;
        v0 = rotl(v0, 32n);
        v2 = (v2 + v3) & MASK64;
        v3 = rotl(v3, 16n);
        v3 ^= v2;
        v0 = (v0 + v3) & MASK64;
        v3 = rotl(v3, 21n);
        v3 ^= v0;
        v2 = (v2 + v1) & MASK64;
        v1 = rotl(v1, 17n);
        v1 ^= v2;
        v2 = rotl(v2, 32n);
    };
    const tail = msg.length & 7;
    const full = msg.length - tail;
    const mv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    for (let i = 0; i < full; i += 8) {
        const m = mv.getBigUint64(i, true);
        v3 ^= m;
        sipround();
        sipround();
        v0 ^= m;
    }
    let b = BigInt(msg.length & 0xff) << 56n;
    for (let i = 0; i < tail; i++) {
        b |= BigInt(msg[full + i] ?? 0) << BigInt(8 * i);
    }
    v3 ^= b;
    sipround();
    sipround();
    v0 ^= b;
    v2 ^= 0xffn;
    sipround();
    sipround();
    sipround();
    sipround();
    const mac = new Uint8Array(SIP_MAC_BYTES);
    new DataView(mac.buffer).setBigUint64(0, (v0 ^ v1 ^ v2 ^ v3) & MASK64, true);
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