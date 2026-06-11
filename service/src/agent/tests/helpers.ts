import { SerialPortMock } from 'serialport';
import SRSserialCollector from '../modules/collectors/srsSerial.js';
import { FormatHelper, SerialCollectorParams } from '../modules/collectors.js';
import { FormattedData, PublishTarget } from '#@shared/types.js';

//opens a mock port instead of real hardware; exposes the protected post() for transport tests
export class MockPortSRSCollector extends SRSserialCollector {
    protected override openPort(path: string, baudRate: number): SerialPortMock {
        SerialPortMock.binding.createPort(path);
        return new SerialPortMock({ path, baudRate });
    }

    get mockPort(): SerialPortMock {
        return this.port as SerialPortMock;
    }

    testPost(location: string, data: unknown, key: string): Promise<string> {
        return this.post(location, data, key);
    }
}

//additionally captures formatted output instead of posting over HTTPS
export class CapturingSRSCollector extends MockPortSRSCollector {
    public captured: FormattedData[][] = [];
    public onCapture: ((f: FormattedData[]) => void) | undefined;

    protected override send(data: string): void {
        const formatted = this.format(data, new FormatHelper());

        if (formatted) {
            this.captured.push(formatted);
            this.onCapture?.(formatted);
        }
    }
}

export const srsParams = (
    path: string,
    opts?: { targets?: PublishTarget[]; extendedOptions?: object }
): SerialCollectorParams => ({
    plugin: 'srsSerial',
    description: 'SRS sim under test',
    site: 'test',
    targets: opts?.targets ?? [{ location: 'https://localhost:1/FIFO', key: 'testkey' }],
    path,
    baudRate: 9600,
    ...(opts?.extendedOptions ? { extendedOptions: opts.extendedOptions } : {})
});
