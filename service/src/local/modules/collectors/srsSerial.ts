import { fetchLogger } from '#@shared/modules/utils.js';
import { FormattedData } from '#@shared/types.js';
import {
    SerialCollector,
    SerialCollectorParams,
    SerialCollectorPlugin,
    FormatHelper
} from '#@service/modules/collectors.js';
import { ReadlineParser } from 'serialport';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = fetchLogger(conf);

interface SRSPortMap {
    [key: number]: string | undefined;
}

const isSRSportMap = (obj: unknown): obj is SRSPortMap => {
    return Array.isArray(obj) && typeof obj[0] === 'string';
};

const radioStates = ['COR', 'PL', 'RCVACT', 'DTMF', 'XMIT_ON'] as const;
const portStates = ['LINK', 'LOOPBACK', 'DISABLED', 'SUDISABLED', 'SPLIT_GROUP', 'INTERFACED'] as const;
type RadioStates = typeof radioStates[number];
type PortStates = typeof portStates[number];

export default class SRSserialCollector extends SerialCollector implements SerialCollectorPlugin {
    constructor(params: SerialCollectorParams) {
        super(params);
    }

    private decode<T extends RadioStates | PortStates>(
        stateList: readonly string[],
        radix: number,
        decodeList: string[]
    ): T[][] {
        const portMatrix: T[][] = [[], [], [], [], [], [], [], []];

        decodeList.forEach((dc, decodeIndex) => {
            const binText: string[] = [];
            let num = parseInt(dc, radix);
            const prefix = radix === 16 ? '0x' : '';

            if (num) {
                log.debug('\n\n');
                log.debug(
                    `Decoding:\t${prefix + dc.toUpperCase()} (${stateList[decodeIndex]}) of ${decodeList.map(
                        v => prefix + v.toUpperCase()
                    )}\t`
                );

                for (let bit = 0; bit < 8 && num; bit++) {
                    if ((num & 1) === 1) {
                        binText.unshift('1');
                        if (typeof stateList[decodeIndex] === 'string') {
                            portMatrix[bit]?.push(stateList[decodeIndex] as T);
                        }
                    } else {
                        binText.unshift('0');
                    }
                    num >>= 1;
                }

                log.debug(`Decoded:\t${binText.toString()}\t\t`);
            }
        });

        return portMatrix;
    }

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        const result = data.match(/[[{]((?:[a-fA-F0-9]{2}\s*)+)[\]}]/);

        const pLookup = (p: number): string => {
            let portName: string | undefined;
            const eo = this.params.extendedOptions;

            if (eo && typeof eo === 'object' && 'portmap' in eo) {
                const { portmap } = eo;
                if (isSRSportMap(portmap)) {
                    portName = portmap[p];
                }
            }

            return portName ? `port-${p} [${portName}]` : `port-${p}`;
        };

        if (typeof result?.[1] === 'string' && (data[0] === '[' || data[0] === '{')) {
            if (data[0] === '[') {
                //prettier-ignore
                return [
                    ...fh
                        .e('RADIO States->')
                        .done,
                    ...this.decode<RadioStates>(radioStates, 16, result[1].split(' ')).flatMap((s, index) =>
                        s.length ? fh
                            .e(`${pLookup(index)}:`)
                            .e(s, 21)
                            .done : []
                    )
                ];
            }
            if (data[0] === '{') {
                //prettier-ignore
                return [
                    ...fh
                        .e('PORT States->')
                        .done,
                    ...this.decode<PortStates>(portStates, 16, result[1].split(' ')).flatMap((s, index) =>
                        s.length ? fh
                            .e(`${pLookup(index)}:`)
                            .e(s, 22)
                            .done : []
                    )
                ];
            }
        }
        return null;
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
