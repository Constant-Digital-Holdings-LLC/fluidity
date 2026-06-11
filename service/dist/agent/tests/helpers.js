import { SerialPortMock } from 'serialport';
import SRSserialCollector from '../modules/collectors/srsSerial.js';
import { FormatHelper } from '../modules/collectors.js';
export class MockPortSRSCollector extends SRSserialCollector {
    openPort(path, baudRate) {
        SerialPortMock.binding.createPort(path);
        return new SerialPortMock({ path, baudRate });
    }
    get mockPort() {
        return this.port;
    }
    testPost(location, data, key) {
        return this.post(location, data, key);
    }
}
export class CapturingSRSCollector extends MockPortSRSCollector {
    captured = [];
    onCapture;
    send(data) {
        const formatted = this.format(data, new FormatHelper());
        if (formatted) {
            this.captured.push(formatted);
            this.onCapture?.(formatted);
        }
    }
}
export const srsParams = (path, opts) => ({
    plugin: 'srsSerial',
    description: 'SRS sim under test',
    site: 'test',
    targets: opts?.targets ?? [{ location: 'https://localhost:1/FIFO', key: 'testkey' }],
    path,
    baudRate: 9600,
    ...(opts?.extendedOptions ? { extendedOptions: opts.extendedOptions } : {})
});
