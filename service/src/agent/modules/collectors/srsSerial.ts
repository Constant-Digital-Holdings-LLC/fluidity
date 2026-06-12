import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData } from '#@shared/types.js';
import { SerialCollector, SerialCollectorParams, SerialCollectorPlugin, FormatHelper, extOpt } from '../collectors.js';
import { ReadlineParser } from 'serialport';

const conf = await confFromFS();

const log = fetchLogger(conf);

//state byte order per SRS Command List 0152, C22A:
//bit 3 stream "[..]": COR, PL, qualified receive, DTMF, PTT
//bit 4 stream "{..}": link, loopback, disabled, sudisabled, split group, interfaced
const radioStates = ['COR', 'PL', 'RCVACT', 'DTMF', 'XMIT_ON'] as const;
const portStates = ['LINK', 'LOOPBACK', 'DISABLED', 'SUDISABLED', 'SPLIT_GROUP', 'INTERFACED'] as const;

//synthetic state for all-zero frames: C22A streams on every state change, so
//the controller sends a zero frame when the last active state releases
const CLEAR_STATE = 'CLEAR';

//carrier-detect events dominate real traffic (~90% of observed production
//packets are COR-only) and release-to-zero frames are chatter on a display
//log - both are hidden by default (extendedOptions.suppress overrides)
const DEFAULT_SUPPRESS = ['COR', CLEAR_STATE];

//strict frame grammar: matched brackets, exactly two-digit hex bytes, single
//spaces, nothing else on the line (trailing whitespace tolerated). The serial
//link has no checksum; on an operations display a misaligned decode is worse
//than a dropped line, so anything that deviates is rejected and counted.
const FRAME_RE = /^([[{])([0-9a-fA-F]{2}(?: [0-9a-fA-F]{2})*)([\]}])\s*$/;

//the longest documented frame is 11 bytes ({..} with C22A bit 7 group
//membership); anything far beyond that is garbage even if it parses
const MAX_FRAME_BYTES = 16;

export type SrsFrameKind = 'radio' | 'port';

export interface SrsFrame {
    kind: SrsFrameKind;
    bytes: number[];
}

export const parseSrsFrame = (line: string): SrsFrame | null => {
    const m = FRAME_RE.exec(line);
    if (!m) return null;

    const open = m[1];
    const hex = m[2];
    const close = m[3];
    if (!open || !hex || !close) return null;

    if ((open === '[' && close !== ']') || (open === '{' && close !== '}')) return null;

    return {
        kind: open === '[' ? 'radio' : 'port',
        //the grammar guarantees every token is exactly two hex digits,
        //so parseInt can never yield NaN and every byte is 0x00-0xff
        bytes: hex.split(' ').map(b => parseInt(b, 16))
    };
};

const isStringArray = (item: unknown): item is string[] =>
    Array.isArray(item) && item.every(s => typeof s === 'string');

type DropReason = 'not-a-frame' | 'truncated' | 'oversized';

export default class SRSserialCollector extends SerialCollector implements SerialCollectorPlugin {
    private readonly portmap: readonly string[] | undefined;
    private readonly suppress: ReadonlySet<string>;

    constructor(params: SerialCollectorParams) {
        super(params);

        //config is validated once, up front, and degrades loudly: a typo'd
        //portmap falls back to port-N labels, a typo'd suppress list falls
        //back to the default - neither may silence the feed
        const eo = params.extendedOptions;

        let portmap: readonly string[] | undefined;
        const pm = extOpt(eo, 'portmap');
        if (pm !== undefined) {
            if (isStringArray(pm)) {
                portmap = pm;
            } else {
                log.warn(
                    `srsSerial [${params.description}]: invalid portmap in extendedOptions ` +
                        `(must be an array of strings) - falling back to port-N labels`
                );
            }
        }
        this.portmap = portmap;

        let suppress: string[] = DEFAULT_SUPPRESS;
        const sup = extOpt(eo, 'suppress');
        if (sup !== undefined) {
            if (isStringArray(sup)) {
                suppress = sup;
            } else {
                log.warn(
                    `srsSerial [${params.description}]: invalid suppress in extendedOptions ` +
                        `(must be an array of strings) - using default ${JSON.stringify(DEFAULT_SUPPRESS)}`
                );
            }
        }
        this.suppress = new Set(suppress);
    }

    //observability for the silent-drop design: anything rejected as noise is
    //counted by reason on the DataCollector base surface (and logged at
    //debug), instead of vanishing untraceably
    private noteLineDrop(reason: DropReason, line: string): void {
        const n = this.noteDrop(reason);

        const shown = line.length > 64 ? `${line.slice(0, 64)}...` : line;
        log.debug(`srsSerial [${this.params.description}]: dropped line (${reason} #${n}): ${shown}`);
    }

    private pLookup(p: number): string {
        const name = this.portmap?.[p];
        return name ? name : `port-${p}`;
    }

    //bit N of each state byte = port N (LSB = port 0), confirmed by the C22A
    //example "[01 01 01 00 ff]" = port 0 receive active, all transmitters on.
    //bytes beyond the known state list (e.g. C22A bit 7 group membership) are
    //tolerated and ignored; zero bytes carry no states.
    private decode<T extends string>(stateList: readonly T[], bytes: number[]): T[][] {
        const portMatrix: T[][] = [[], [], [], [], [], [], [], []];

        bytes.forEach((byte, index) => {
            const state = stateList[index];
            if (state === undefined || byte === 0) return;

            const binText: string[] = [];
            let num = byte;

            log.debug(`Decoding:\t0x${byte.toString(16).toUpperCase().padStart(2, '0')} (${state})`);

            for (let bit = 0; bit < 8 && num; bit++) {
                if ((num & 1) === 1) {
                    binText.unshift('1');
                    portMatrix[bit]?.push(state);
                } else {
                    binText.unshift('0');
                }
                num >>= 1;
            }

            log.debug(`Decoded:\t${binText.toString()}`);
        });

        return portMatrix;
    }

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        const frame = parseSrsFrame(data);

        if (!frame) {
            this.noteLineDrop('not-a-frame', data);
            return null;
        }

        const expected = frame.kind === 'radio' ? radioStates.length : portStates.length;

        if (frame.bytes.length < expected) {
            this.noteLineDrop('truncated', data);
            return null;
        }
        if (frame.bytes.length > MAX_FRAME_BYTES) {
            this.noteLineDrop('oversized', data);
            return null;
        }

        const heading = frame.kind === 'radio' ? 'Radio States: ' : 'Port States: ';
        const stateStyle = frame.kind === 'radio' ? 9 : 7;
        const matrix: readonly string[][] =
            frame.kind === 'radio' ? this.decode(radioStates, frame.bytes) : this.decode(portStates, frame.bytes);

        const states = matrix.flat();

        //all-zero frame: the controller reporting that nothing is active -
        //the release event after a transmission. Suppressed by default.
        if (states.length === 0) {
            if (this.suppress.has(CLEAR_STATE)) return null;
            return [...fh.e(heading).done, ...fh.e('all clear', 10).done];
        }

        //a frame whose states are all suppressed is noise; anything more
        //passes through complete (suppressed states included, for context)
        if (states.every(s => this.suppress.has(s))) return null;

        const fields = matrix.flatMap((s, index) =>
            s.length ? fh.e(`${this.pLookup(index)}:`, 3).e(s, stateStyle).done : []
        );

        return [...fh.e(heading).done, ...fields];
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
