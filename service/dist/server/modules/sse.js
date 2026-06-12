export class ServerSideEvents {
    clients = new Set();
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
        const drop = () => {
            this.clients.delete(res);
        };
        req.on('close', drop);
        res.on('error', drop);
    };
    send(data, event, id) {
        const payload = (typeof id === 'number' ? `id: ${id}\n` : '') + (event ? `event: ${event}\n` : '') + `data: ${data}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(payload);
            }
            catch {
                this.clients.delete(client);
            }
        }
    }
}
