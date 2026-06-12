//Render backpressure for the live stream. SSE can deliver thousands of
//packets a second (a device flood, a reconnect replay); doing per-packet DOM
//work synchronously on each message saturates the main thread and hangs the
//tab. So receipt only enqueues, and this drains the queue on a frame tick
//with a bounded budget - the same discipline the TUI gets for free from its
//redraw loop. The live view is a tail, so a backlog beyond `cap` sheds its
//oldest entries (they remain in the server FIFO/history); the sparkline still
//counts every arrival, so the rate it shows stays honest.

export interface PumpLimits {
    budget: number; //max items rendered per frame
    cap: number; //max queue depth retained; older items are shed under flood
}

export interface DrainResult {
    rendered: number;
    dropped: number;
}

//mutates `queue` in place: sheds oldest beyond cap, then renders up to budget
//from the front in arrival order. `render` may be null before the UI exists
//(packets are still shed to the cap so memory stays bounded during load).
export const drainRenderQueue = <T>(
    queue: T[],
    limits: PumpLimits,
    render: ((item: T) => void) | null
): DrainResult => {
    let dropped = 0;
    if (queue.length > limits.cap) {
        dropped = queue.length - limits.cap;
        queue.splice(0, dropped);
    }

    let rendered = 0;
    if (render) {
        rendered = Math.min(queue.length, limits.budget);
        for (let i = 0; i < rendered; i++) {
            render(queue.shift() as T);
        }
    }

    return { rendered, dropped };
};
