import { Request, Response, NextFunction } from 'express';

//a subscriber that stops reading without closing (TCP zero-window, suspended
//laptop, half-open connection) never fires 'close'/'error', so its response
//buffer would grow by every broadcast - evict once it backs up this far
const MAX_BUFFERED_BYTES = 1024 * 1024;

//comment frames keep intermediaries from idling the connection out and give
//half-open sockets regular traffic to back up against, so eviction triggers
//even when the feed itself is quiet
const HEARTBEAT_MS = 30_000;

//minimal server-sent-events broadcaster, replacing the unmaintained express-sse-ts
//(same wire format: optional id line, data line, blank-line terminator)
export class ServerSideEvents {
    private clients = new Set<Response>();
    private heartbeat: NodeJS.Timeout | null = null;

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
        if (!this.heartbeat) {
            this.heartbeat = setInterval(() => this.broadcast(': hb\n\n'), HEARTBEAT_MS);
            this.heartbeat.unref();
        }

        const drop = (): void => {
            this.clients.delete(res);
            if (this.clients.size === 0 && this.heartbeat) {
                clearInterval(this.heartbeat);
                this.heartbeat = null;
            }
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

        this.broadcast(payload);
    }

    private broadcast(payload: string): void {
        for (const client of this.clients) {
            //a stalled reader buffers server-side without bound; cut it loose
            //(destroying the socket fires 'close', which runs drop())
            if (client.writableLength > MAX_BUFFERED_BYTES) {
                this.clients.delete(client);
                client.destroy();
                continue;
            }
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
