const MAX_BUFFERED_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
export class ServerSideEvents {
    clients = new Set();
    heartbeat = null;
    init = (req, res, next) => {
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
        const drop = () => {
            this.clients.delete(res);
            if (this.clients.size === 0 && this.heartbeat) {
                clearInterval(this.heartbeat);
                this.heartbeat = null;
            }
        };
        req.on('close', drop);
        res.on('error', drop);
    };
    send(data, event, id) {
        const payload = (typeof id === 'number' ? `id: ${id}\n` : '') + (event ? `event: ${event}\n` : '') + `data: ${data}\n\n`;
        this.broadcast(payload);
    }
    broadcast(payload) {
        for (const client of this.clients) {
            if (client.writableLength > MAX_BUFFERED_BYTES) {
                this.clients.delete(client);
                client.destroy();
                continue;
            }
            try {
                client.write(payload);
            }
            catch {
                this.clients.delete(client);
            }
        }
    }
}
