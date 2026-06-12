//fast typewriter reveal for live packet lines. Walks the element's text
//nodes (the packet is many styled spans), blanks them, and restores
//characters in document order on animation frames. Instant (no-op) when
//rAF is unavailable (jsdom/tests) or the user prefers reduced motion.

export interface TypeOpts {
    cps?: number; //characters per second
    raf?: (cb: (now: number) => void) => void; //injectable for tests
    now?: () => number;
}

const MAX_CONCURRENT = 12; //packet bursts degrade to instant, never to jank
let active = 0;

export const typeIn = (root: HTMLElement, opts?: TypeOpts): void => {
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const raf = opts?.raf ?? globalThis.requestAnimationFrame;
    const now = opts?.now ?? ((): number => performance.now());

    if (reduced || typeof raf !== 'function' || active >= MAX_CONCURRENT) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; full: string }[] = [];
    let total = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n as Text;
        nodes.push({ node: text, full: text.data });
        total += text.data.length;
    }
    if (total === 0) return;

    nodes.forEach(e => {
        e.node.data = '';
    });

    const cps = opts?.cps ?? 420;
    const start = now();
    active++;

    //reveal the first `count` characters in document order (idempotent)
    const apply = (count: number): void => {
        let left = count;
        for (const e of nodes) {
            const take = Math.max(0, Math.min(e.full.length, left));
            const next = e.full.slice(0, take);
            if (e.node.data !== next) e.node.data = next;
            left -= take;
        }
    };

    const step = (t: number): void => {
        const want = Math.min(total, Math.floor(((t - start) / 1000) * cps) + 1);
        apply(want);

        if (want < total) {
            raf(step);
        } else {
            active--;
        }
    };

    raf(step);
};
