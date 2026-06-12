export const FLU_MAGIC = 0x31554c46;
export const FLU_VERSION = 1;
export const FLU_F_TS = 0x01;
export const FLU_F_MAC = 0x02;
export const FLU_MAX_FIELDS = 4;
export const FLU_HEADER_BYTES = 61;
export const FLU_FIELD_BYTES = 42;
export const FLU_FIELD_TEXT = 40;
export const FLU_NAME_BYTES = 16;
export const FLU_FULL_BYTES = FLU_HEADER_BYTES + FLU_MAX_FIELDS * FLU_FIELD_BYTES;
export const FLU_MAC_BYTES = 8;
export const FLU_MAX_DATAGRAM = FLU_FULL_BYTES + FLU_MAC_BYTES;
export const FLU_DEFAULT_PORT = 17996;
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const decodeName = (buf, offset, width) => {
    let end = offset;
    const limit = offset + width;
    while (end < limit && buf[end] !== 0)
        end++;
    try {
        const text = utf8Strict.decode(buf.subarray(offset, end));
        return text.replace(/[\x00-\x1f\x7f]/g, '').trim();
    }
    catch {
        return null;
    }
};
export const decodeFluPacket = (buf, opts) => {
    if (buf.length < FLU_HEADER_BYTES || buf.length > FLU_MAX_DATAGRAM) {
        return { ok: false, reason: 'bad-length' };
    }
    if (buf.readUInt32LE(0) !== FLU_MAGIC) {
        return { ok: false, reason: 'not-fluidity' };
    }
    if (buf[4] !== FLU_VERSION) {
        return { ok: false, reason: 'bad-version' };
    }
    const flags = buf[5] ?? 0;
    const hasMac = (flags & FLU_F_MAC) !== 0;
    const macLen = hasMac ? FLU_MAC_BYTES : 0;
    const fieldCount = buf[FLU_HEADER_BYTES - 1] ?? 0;
    const compact = buf.length === FLU_HEADER_BYTES + fieldCount * FLU_FIELD_BYTES + macLen;
    const full = buf.length === FLU_FULL_BYTES + macLen;
    if (!compact && !full) {
        return { ok: false, reason: 'bad-length' };
    }
    if (hasMac && opts?.verifyMac) {
        const split = buf.length - FLU_MAC_BYTES;
        if (!opts.verifyMac(buf.subarray(0, split), buf.subarray(split))) {
            return { ok: false, reason: 'bad-mac' };
        }
    }
    if (fieldCount < 1 || fieldCount > FLU_MAX_FIELDS) {
        return { ok: false, reason: 'bad-fields' };
    }
    const site = decodeName(buf, 12, FLU_NAME_BYTES);
    const plugin = decodeName(buf, 28, FLU_NAME_BYTES);
    const description = decodeName(buf, 44, FLU_NAME_BYTES);
    if (site === null || plugin === null || description === null) {
        return { ok: false, reason: 'bad-encoding' };
    }
    if (site.length === 0 || plugin.length === 0) {
        return { ok: false, reason: 'bad-identity' };
    }
    const fields = [];
    for (let i = 0; i < fieldCount; i++) {
        const base = FLU_HEADER_BYTES + i * FLU_FIELD_BYTES;
        const text = decodeName(buf, base + 2, FLU_FIELD_TEXT);
        if (text === null) {
            return { ok: false, reason: 'bad-encoding' };
        }
        fields.push({ style: buf[base] ?? 0, text });
    }
    const hasTs = (flags & FLU_F_TS) !== 0;
    return {
        ok: true,
        packet: {
            deviceSeq: buf.readUInt16LE(6),
            tsEpochMs: hasTs ? buf.readUInt32LE(8) * 1000 : null,
            hasMac,
            site,
            plugin,
            description,
            fields
        }
    };
};
const writeName = (buf, offset, width, text) => {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > width) {
        throw new Error(`field too long for wire (${bytes.length} > ${width}): ${text}`);
    }
    bytes.copy(buf, offset);
};
export const encodeFluPacket = (input) => {
    if (input.fields.length < 1 || input.fields.length > FLU_MAX_FIELDS) {
        throw new Error(`field count must be 1..${FLU_MAX_FIELDS}`);
    }
    const count = input.full ? FLU_MAX_FIELDS : input.fields.length;
    const buf = Buffer.alloc(FLU_HEADER_BYTES + count * FLU_FIELD_BYTES);
    buf.writeUInt32LE(FLU_MAGIC, 0);
    buf[4] = FLU_VERSION;
    buf[5] = input.tsEpochSec !== undefined ? FLU_F_TS : 0;
    buf.writeUInt16LE(input.deviceSeq ?? 0, 6);
    buf.writeUInt32LE(input.tsEpochSec ?? 0, 8);
    writeName(buf, 12, FLU_NAME_BYTES, input.site);
    writeName(buf, 28, FLU_NAME_BYTES, input.plugin);
    writeName(buf, 44, FLU_NAME_BYTES, input.description ?? '');
    buf[FLU_HEADER_BYTES - 1] = input.fields.length;
    input.fields.forEach((f, i) => {
        const base = FLU_HEADER_BYTES + i * FLU_FIELD_BYTES;
        buf[base] = f.style & 0xff;
        writeName(buf, base + 2, FLU_FIELD_TEXT, f.text);
    });
    return buf;
};
