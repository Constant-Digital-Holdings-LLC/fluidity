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

        const drop = (): void => {
            this.clients.delete(res);
        };
        req.on('close', drop);
        //a client socket can emit 'error' (reset, premature close) independently
        //of 'close'; without a listener that error is unhandled and crashes the
        //whole server, taking every other subscriber down with it. Drop the
        //client instead - exactly the failure mode SSE fanout sees under churn.
        res.on('error', drop);
    };

    send(data: string, event?: string, id?: number): void {
        const payload =
            (typeof id === 'number' ? `id: ${id}\n` : '') + (event ? `event: ${event}\n` : '') + `data: ${data}\n\n`;

        for (const client of this.clients) {
            //a write can throw on an already-destroyed socket; isolate each
            //client so one bad connection can't abort the broadcast to the rest
            try {
                client.write(payload);
            } catch {
                this.clients.delete(client);
            }
        }
    }
}
