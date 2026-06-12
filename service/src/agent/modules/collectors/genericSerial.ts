import { FormattedData } from '#@shared/types.js';
import { SerialCollector, SerialCollectorParams, SerialCollectorPlugin, FormatHelper } from '../collectors.js';
import { ReadlineParser } from 'serialport';

export default class GenericSerialCollector extends SerialCollector implements SerialCollectorPlugin {
    constructor(params: SerialCollectorParams) {
        super(params);
    }

    //CRLF devices (the reference sketch among them) leave a trailing \r when
    //splitting on \n alone - strip it rather than forward a control byte to
    //every client; bare-\n devices are unaffected, blank lines are dropped
    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        const line = data.replace(/\r$/, '');
        return line ? fh.e(line).done : null;
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
