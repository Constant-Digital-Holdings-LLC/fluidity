import https from 'node:https';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { SerialPortMock } from 'serialport';
import SRSserialCollector from '../modules/collectors/srsSerial.js';
import { FormatHelper, SerialCollectorParams } from '../modules/collectors.js';
import { FormattedData, PublishTarget } from '#@shared/types.js';

//cwd-independent: resolved from this module's compiled location
//(service/dist/agent/tests/) to the repo dev certs next door.
//NODE_ENV=development makes the agent skip chain verification on loopback,
//like real dev use.
const sslPath = (f: string): string => fileURLToPath(new URL(`../../server/ssl/${f}`, import.meta.url));

export const tlsOptions = {
    key: readFileSync(sslPath('dev-server_key.pem')),
    cert: readFileSync(sslPath('dev-server_cert.pem'))
};

export interface TestTarget {
    server: https.Server;
    location: string;
    received: unknown[];
    next(): Promise<unknown>;
}

//local HTTPS publish target: collects every POSTed body and hands the next
//one to whoever is awaiting it
export const startTarget = async (statusCode = 200): Promise<TestTarget> => {
    const received: unknown[] = [];
    let waiters: ((p: unknown) => void)[] = [];

    const server = https.createServer(tlsOptions, (req, res) => {
        let body = '';
        req.on('data', (c: string) => (body += c));
        req.on('end', () => {
            const parsed: unknown = JSON.parse(body);
            received.push(parsed);
            waiters.forEach(w => w(parsed));
            waiters = [];
            res.statusCode = statusCode;
            res.end();
        });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    return {
        server,
        location: `https://localhost:${port}/FIFO`,
        received,
        next: () => new Promise(resolve => waiters.push(resolve))
    };
};

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
