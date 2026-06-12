//flu_packet_v1 wire codec, per service/UDP-SPEC.md §3.
//Pure functions over Buffers - no sockets, no config, no side effects -
//so firmware compatibility is testable byte-for-byte. Little-endian
//throughout (every target MCU is LE; the agent does the interpretation).

import { stripControlChars } from '#@shared/types.js';

export const FLU_MAGIC = 0x31554c46; //bytes "FLU1" on the wire (LE read)
export const FLU_VERSION = 1;

export const FLU_F_TS = 0x01;
export const FLU_F_MAC = 0x02;

export const FLU_MAX_FIELDS = 4;
export const FLU_HEADER_BYTES = 61; //through field_count
export const FLU_FIELD_BYTES = 42; //style + reserved + text[40]
export const FLU_FIELD_TEXT = 40;
export const FLU_NAME_BYTES = 16; //site/plugin/description
export const FLU_FULL_BYTES = FLU_HEADER_BYTES + FLU_MAX_FIELDS * FLU_FIELD_BYTES; //229
export const FLU_MAC_BYTES = 8;
export const FLU_MAX_DATAGRAM = FLU_FULL_BYTES + FLU_MAC_BYTES; //237

export const FLU_DEFAULT_PORT = 17996; //0x464C, "FL"

export type FluDropReason =
    | 'bad-length'
    | 'not-fluidity'
    | 'bad-version'
    | 'bad-mac'
    | 'bad-fields'
    | 'bad-encoding'
    | 'bad-identity';

export interface FluField {
    style: number;
    text: string;
}

export interface FluDecoded {
    deviceSeq: number;
    //unix ms when the device flagged a valid clock, else null (caller stamps);
    //the ±24h sanity policy is the collector's (it knows "now")
    tsEpochMs: number | null;
    hasMac: boolean;
    site: string;
    plugin: string;
    description: string;
    fields: FluField[];
}

//error results carry hasMac once the flags byte was parsed, so the caller's
//migration-mode 'unsigned' accounting (§6 step 5) sees malformed unsigned
//datagrams too, not just ones that survive the structural checks
export type FluResult = { ok: true; packet: FluDecoded } | { ok: false; reason: FluDropReason; hasMac?: boolean };

export interface FluDecodeOptions {
    //MAC verification hook, invoked only when the datagram carries a trailer:
    //signed = everything before the trailer, mac = the 8 trailer bytes.
    //Runs between the exact-length check (§6 step 4) and the field-count
    //check (step 6), so a tampered datagram drops as bad-mac, never as some
    //downstream reason. The codec stays key-free; policy lives in the caller.
    verifyMac?: (signed: Buffer, mac: Buffer) => boolean;
    //§6 step 5 missing-trailer policy: when set, an unsigned datagram drops
    //as bad-mac HERE - before field-count/UTF-8 - so drop accounting never
    //misattributes unauthenticated traffic to a structural reason
    requireMac?: boolean;
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

//senders truncate bytewise at the field width (firmware flu__copy, sim
//packName - strncpy semantics by design), which can cut a multibyte
//sequence: a dangling tail is width truncation, not garbage. Trim it so the
//datagram survives; interior invalid bytes still fail strict decode.
const trimIncompleteUtf8Tail = (bytes: Buffer): Buffer => {
    let i = bytes.length - 1;
    let cont = 0;
    //walk back over up to 3 continuation bytes (10xxxxxx)
    while (i >= 0 && cont < 3 && ((bytes[i] ?? 0) & 0xc0) === 0x80) {
        i--;
        cont++;
    }
    if (i < 0) return bytes; //nothing but continuations - let strict decode judge
    const lead = bytes[i] ?? 0;
    let need = 0;
    if ((lead & 0xe0) === 0xc0) need = 1;
    else if ((lead & 0xf0) === 0xe0) need = 2;
    else if ((lead & 0xf8) === 0xf0) need = 3;
    else return bytes; //ascii or invalid lead - not a truncation pattern
    return cont >= need ? bytes : bytes.subarray(0, i);
};

//NUL-terminated, UTF-8-validated, control-chars stripped - C0, DEL, and C1
//(renderers sanitize again, but the agent never forwards raw control bytes)
const decodeName = (buf: Buffer, offset: number, width: number): string | null => {
    let end = offset;
    const limit = offset + width;
    while (end < limit && buf[end] !== 0) end++;

    try {
        const text = utf8Strict.decode(trimIncompleteUtf8Tail(buf.subarray(offset, end)));

        return stripControlChars(text).trim();
    } catch {
        return null;
    }
};

export const decodeFluPacket = (buf: Buffer, opts?: FluDecodeOptions): FluResult => {
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

    //exact-length-or-drop (§3.2): the compact form sized to field_count, or
    //the full struct (firmware sends sizeof) with surplus fields ignored.
    //Length is judged against the claimed count (§6 step 4) before the count
    //itself is judged (step 6), so each firmware bug gets its own counter.
    const compact = buf.length === FLU_HEADER_BYTES + fieldCount * FLU_FIELD_BYTES + macLen;
    const full = buf.length === FLU_FULL_BYTES + macLen;
    if (!compact && !full) {
        return { ok: false, reason: 'bad-length', hasMac };
    }

    //§6 step 5: the MAC covers every preceding byte (flags included), so a
    //failed verification masks all later reasons - the bytes can't be trusted
    if (hasMac && opts?.verifyMac) {
        const split = buf.length - FLU_MAC_BYTES;
        if (!opts.verifyMac(buf.subarray(0, split), buf.subarray(split))) {
            return { ok: false, reason: 'bad-mac', hasMac };
        }
    }

    //§6 step 5, missing-trailer half: in MAC mode an unsigned datagram is as
    //bad as a tampered one, and must never count as bad-fields/bad-encoding
    if (!hasMac && opts?.requireMac) {
        return { ok: false, reason: 'bad-mac', hasMac };
    }

    if (fieldCount < 1 || fieldCount > FLU_MAX_FIELDS) {
        return { ok: false, reason: 'bad-fields', hasMac };
    }

    const site = decodeName(buf, 12, FLU_NAME_BYTES);
    const plugin = decodeName(buf, 28, FLU_NAME_BYTES);
    const description = decodeName(buf, 44, FLU_NAME_BYTES);
    if (site === null || plugin === null || description === null) {
        return { ok: false, reason: 'bad-encoding', hasMac };
    }
    if (site.length === 0 || plugin.length === 0) {
        return { ok: false, reason: 'bad-identity', hasMac };
    }

    const fields: FluField[] = [];
    for (let i = 0; i < fieldCount; i++) {
        const base = FLU_HEADER_BYTES + i * FLU_FIELD_BYTES;
        const text = decodeName(buf, base + 2, FLU_FIELD_TEXT);
        if (text === null) {
            return { ok: false, reason: 'bad-encoding', hasMac };
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

//encoder for the sim, tests, and as executable documentation of the format
export interface FluEncodeInput {
    site: string;
    plugin: string;
    description?: string;
    fields: FluField[];
    deviceSeq?: number;
    tsEpochSec?: number; //sets FLU_F_TS
    full?: boolean; //emit the full struct (sizeof) instead of the compact form
}

const writeName = (buf: Buffer, offset: number, width: number, text: string): void => {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > width) {
        throw new Error(`field too long for wire (${bytes.length} > ${width}): ${text}`);
    }
    bytes.copy(buf, offset);
};

export const encodeFluPacket = (input: FluEncodeInput): Buffer => {
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
