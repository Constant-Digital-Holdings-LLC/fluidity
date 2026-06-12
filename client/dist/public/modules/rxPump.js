export const drainRenderQueue = (queue, limits, render) => {
    let dropped = 0;
    if (queue.length > limits.cap) {
        dropped = queue.length - limits.cap;
        queue.splice(0, dropped);
    }
    let rendered = 0;
    if (render) {
        rendered = Math.min(queue.length, limits.budget);
        for (let i = 0; i < rendered; i++) {
            render(queue.shift());
        }
    }
    return { rendered, dropped };
};
//# sourceMappingURL=rxPump.js.map