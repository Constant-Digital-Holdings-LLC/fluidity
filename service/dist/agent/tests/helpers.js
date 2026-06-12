import https from 'node:https';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { SerialPortMock } from 'serialport';
import SRSserialCollector from '../modules/collectors/srsSerial.js';
import { FormatHelper } from '../modules/collectors.js';
export const tlsOptions = {
    key: readFileSync('../server/ssl/dev-server_key.pem'),
    cert: readFileSync('../server/ssl/dev-server_cert.pem')
};
export const startTarget = async (statusCode = 200) => {
    const received = [];
    let waiters = [];
    const server = https.createServer(tlsOptions, (req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            const parsed = JSON.parse(body);
            received.push(parsed);
            waiters.forEach(w => w(parsed));
            waiters = [];
            res.statusCode = statusCode;
            res.end();
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    return {
        server,
        location: `https://localhost:${port}/FIFO`,
        received,
        next: () => new Promise(resolve => waiters.push(resolve))
    };
};
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
