import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { FormattedData, FluidityPacket, PublishTarget, FluidityField, StringAble } from '#@shared/types.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = fetchLogger(conf);

type SerialParser = ReadlineParser | RegexParser;

export interface DataCollectorParams extends Omit<FluidityPacket, 'delimData'> {
    targets: PublishTarget[];
    omitTS?: boolean;
    keepRaw?: boolean;
    extendedOptions?: unknown;
}

export interface SerialCollectorParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

export class FormatHelper {
    private formattedData: FormattedData[] = [];

    e(element: FluidityField | StringAble, suggestStyle?: number): this {
        suggestStyle ??= 0;
        if (typeof element === 'string') {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'STRING' });
        } else if (element instanceof Object && 'location' in element && 'name' in element) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'LINK' });
        } else if (element instanceof Date) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'DATE' });
        } else {
            this.formattedData.push({ suggestStyle, field: element.toString(), fieldType: 'STRING' });
        }

        return this;
    }

    get done(): FormattedData[] {
        const clone: FormattedData[] = JSON.parse(JSON.stringify(this.formattedData));
        this.formattedData.length = 0;
        return clone;
    }
}

export interface DataCollectorPlugin {
    start(): void;
    stop?(): void;
}

export abstract class DataCollector implements DataCollectorPlugin {
    constructor(public params: DataCollectorParams) {
        const { targets, site, description, plugin, keepRaw, omitTS } = params || {};

        // for ${params.collectorType}: ${params.label}

        if (!Array.isArray(targets)) {
            throw new Error(`DataCollector constructor - expected array of targets[] in config`);
        }
        if (typeof site !== 'string') {
            throw new Error(`DataCollector constructor - site name in config`);
        }
        if (typeof description !== 'string') {
            throw new Error(`DataCollector constructor - collector ${plugin} missing description in config`);
        }
        if (typeof plugin !== 'string') {
            throw new Error(`DataCollector constructor - collector ${description} requires a plugin field in config`);
        }
        if (typeof keepRaw !== 'undefined' && typeof keepRaw !== 'boolean') {
            throw new Error(
                `DataCollector constructor - optional keepRaw field should be a boolean for collector: ${plugin}`
            );
        }
        if (typeof omitTS !== 'undefined' && typeof omitTS !== 'boolean') {
            throw new Error(
                `DataCollector constructor - optional omitTS field should be a boolean for collector ${plugin}`
            );
        }
    }

    abstract start(): void;
    stop(): void {
        log.info(`stopped: ${this.params.plugin}`);
    }

    protected format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    private addTS(data: FormattedData[]): FormattedData[] {
        return data;
    }

    private sendHttps(fPacket: FluidityPacket): void {
        log.debug('############### BEGIN ONE HTTP POST ###############');
        log.debug(fPacket);
        log.debug('############### END ONE HTTP POST   ###############');
    }

    protected send(data: string): void {
        const { site, description, plugin, targets, keepRaw } = this.params;

        let formattedData = this.format(data, new FormatHelper());

        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        log.debug(`location: ${t.location}, `);

                        if (formattedData) {
                            this.sendHttps({
                                site,
                                description,
                                plugin,
                                formattedData: formattedData,
                                rawData: keepRaw ? data : null
                            });
                        }
                    } else {
                        throw new Error(`unsupported protocol in target location: ${t.location}`);
                    }
                });
            } catch (err) {
                log.error(err);
            }
        } else {
            log.debug(`DataCollector: ignoring unkown string: ${data}`);
        }
    }
}

export interface SerialCollectorPlugin extends DataCollectorPlugin {
    fetchParser(): SerialParser;
}

export abstract class SerialCollector extends DataCollector implements SerialCollectorPlugin {
    port: SerialPort;
    parser: SerialParser;

    abstract fetchParser(): SerialParser;

    constructor({ path, baudRate, ...params }: SerialCollectorParams) {
        super(params);

        if (typeof path !== 'string')
            throw new Error(
                `expected serial port identifier (string) in config for ${params.plugin}: ${params.description}`
            );
        if (typeof baudRate !== 'number')
            throw new Error(`expected numeric port speed in config for ${params.plugin}: ${params.description}`);

        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }

    start(): void {
        this.parser.on('data', this.send.bind(this));
        log.info(`${this.params.plugin} started`);
    }
}
