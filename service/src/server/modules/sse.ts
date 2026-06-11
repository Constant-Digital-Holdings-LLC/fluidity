import { Request, Response, NextFunction } from 'express';

//minimal server-sent-events broadcaster, replacing the unmaintained express-sse-ts
//(same wire format: optional id line, data line, blank-line terminator)
export class ServerSideEvents {
    private clients = new Set<Response>();

    init = (req: Request, res: Response, next?: NextFunction): void => {
        void next;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.write('retry: 5000\n\n');

        this.clients.add(res);
        req.on('close', () => {
            this.clients.delete(res);
        });
    };

    send(data: string, event?: string, id?: number): void {
        const payload =
            (typeof id === 'number' ? `id: ${id}\n` : '') + (event ? `event: ${event}\n` : '') + `data: ${data}\n\n`;

        for (const client of this.clients) {
            client.write(payload);
        }
    }
}
