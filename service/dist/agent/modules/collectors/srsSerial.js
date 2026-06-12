import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialCollector, extOpt } from '../collectors.js';
import { ReadlineParser } from 'serialport';
const conf = await confFromFS();
const log = fetchLogger(conf);
const radioStates = ['COR', 'PL', 'RCVACT', 'DTMF', 'XMIT_ON'];
const portStates = ['LINK', 'LOOPBACK', 'DISABLED', 'SUDISABLED', 'SPLIT_GROUP', 'INTERFACED'];
const CLEAR_STATE = 'CLEAR';
const DEFAULT_SUPPRESS = ['COR', CLEAR_STATE];
const FRAME_RE = /^([[{])([0-9a-fA-F]{2}(?: [0-9a-fA-F]{2})*)([\]}])\s*$/;
const MAX_FRAME_BYTES = 16;
export const parseSrsFrame = (line) => {
    const m = FRAME_RE.exec(line);
    if (!m)
        return null;
    const open = m[1];
    const hex = m[2];
    const close = m[3];
    if (!open || !hex || !close)
        return null;
    if ((open === '[' && close !== ']') || (open === '{' && close !== '}'))
        return null;
    return {
        kind: open === '[' ? 'radio' : 'port',
        bytes: hex.split(' ').map(b => parseInt(b, 16))
    };
};
const isStringArray = (item) => Array.isArray(item) && item.every(s => typeof s === 'string');
export default class SRSserialCollector extends SerialCollector {
    portmap;
    suppress;
    constructor(params) {
        super(params);
        const eo = params.extendedOptions;
        let portmap;
        const pm = extOpt(eo, 'portmap');
        if (pm !== undefined) {
            if (isStringArray(pm)) {
                portmap = pm;
            }
            else {
                log.warn(`srsSerial [${params.description}]: invalid portmap in extendedOptions ` +
                    `(must be an array of strings) - falling back to port-N labels`);
            }
        }
        this.portmap = portmap;
        let suppress = DEFAULT_SUPPRESS;
        const sup = extOpt(eo, 'suppress');
        if (sup !== undefined) {
            if (isStringArray(sup)) {
                suppress = sup;
            }
            else {
                log.warn(`srsSerial [${params.description}]: invalid suppress in extendedOptions ` +
                    `(must be an array of strings) - using default ${JSON.stringify(DEFAULT_SUPPRESS)}`);
            }
        }
        this.suppress = new Set(suppress);
    }
    noteLineDrop(reason, line) {
        const n = this.noteDrop(reason);
        const shown = line.length > 64 ? `${line.slice(0, 64)}...` : line;
        log.debug(`srsSerial [${this.params.description}]: dropped line (${reason} #${n}): ${shown}`);
    }
    pLookup(p) {
        const name = this.portmap?.[p];
        return name ? name : `port-${p}`;
    }
    decode(stateList, bytes) {
        const portMatrix = [[], [], [], [], [], [], [], []];
        bytes.forEach((byte, index) => {
            const state = stateList[index];
            if (state === undefined || byte === 0)
                return;
            const binText = [];
            let num = byte;
            log.debug(`Decoding:\t0x${byte.toString(16).toUpperCase().padStart(2, '0')} (${state})`);
            for (let bit = 0; bit < 8 && num; bit++) {
                if ((num & 1) === 1) {
                    binText.unshift('1');
                    portMatrix[bit]?.push(state);
                }
                else {
                    binText.unshift('0');
                }
                num >>= 1;
            }
            log.debug(`Decoded:\t${binText.toString()}`);
        });
        return portMatrix;
    }
    format(data, fh) {
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
        const matrix = frame.kind === 'radio' ? this.decode(radioStates, frame.bytes) : this.decode(portStates, frame.bytes);
        const states = matrix.flat();
        if (states.length === 0) {
            if (this.suppress.has(CLEAR_STATE))
                return null;
            return [...fh.e(heading).done, ...fh.e('all clear', 10).done];
        }
        if (states.every(s => this.suppress.has(s)))
            return null;
        const fields = matrix.flatMap((s, index) => s.length ? fh.e(`${this.pLookup(index)}:`, 3).e(s, stateStyle).done : []);
        return [...fh.e(heading).done, ...fields];
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
