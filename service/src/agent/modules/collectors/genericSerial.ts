import { FormattedData } from '#@shared/types.js';
import { SerialCollector, SerialCollectorParams, SerialCollectorPlugin, FormatHelper, extOpt } from '../collectors.js';
import { parseTokenizeConfig, toFields, TokenizeConfig } from '../tokenize.js';
import { ReadlineParser } from 'serialport';

export default class GenericSerialCollector extends SerialCollector implements SerialCollectorPlugin {
    //the shared line tokenizer is OFF by default here: generic serial data may
    //be arbitrary (even binary-ish), so silently tokenizing could mangle it -
    //opt in with extendedOptions.tokenize. logTail defaults it on.
    private readonly tok: TokenizeConfig;

    constructor(params: SerialCollectorParams) {
        super(params);
        this.tok = parseTokenizeConfig(
            extOpt(params.extendedOptions, 'tokenize'),
            false,
            `genericSerial [${params.description}]`
        );
    }

    //CRLF devices (the reference sketch among them) leave a trailing \r when
    //splitting on \n alone - strip it rather than forward a control byte to
    //every client; bare-\n devices are unaffected, blank lines are dropped.
    //Then through the shared tokenizer when enabled (off by default = the line
    //as one STRING, the prior behavior).
    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        void fh;
        const line = data.replace(/\r$/, '');
        return line ? toFields(line, this.tok) : null;
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
