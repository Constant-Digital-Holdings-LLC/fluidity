const MAX_CONCURRENT = 12;
let active = 0;
export const typeIn = (root, opts) => {
    var _a, _b, _c, _d, _e;
    const reduced = (_b = (_a = globalThis.matchMedia) === null || _a === void 0 ? void 0 : _a.call(globalThis, '(prefers-reduced-motion: reduce)').matches) !== null && _b !== void 0 ? _b : false;
    const raf = (_c = opts === null || opts === void 0 ? void 0 : opts.raf) !== null && _c !== void 0 ? _c : globalThis.requestAnimationFrame;
    const now = (_d = opts === null || opts === void 0 ? void 0 : opts.now) !== null && _d !== void 0 ? _d : (() => performance.now());
    if (reduced || typeof raf !== 'function' || active >= MAX_CONCURRENT)
        return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let total = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n;
        nodes.push({ node: text, full: text.data });
        total += text.data.length;
    }
    if (total === 0)
        return;
    nodes.forEach(e => {
        e.node.data = '';
    });
    const cps = (_e = opts === null || opts === void 0 ? void 0 : opts.cps) !== null && _e !== void 0 ? _e : 420;
    const start = now();
    active++;
    const apply = (count) => {
        let left = count;
        for (const e of nodes) {
            const take = Math.max(0, Math.min(e.full.length, left));
            const next = e.full.slice(0, take);
            if (e.node.data !== next)
                e.node.data = next;
            left -= take;
        }
    };
    const step = (t) => {
        const want = Math.min(total, Math.floor(((t - start) / 1000) * cps) + 1);
        apply(want);
        if (want < total) {
            raf(step);
        }
        else {
            active--;
        }
    };
    raf(step);
};
//# sourceMappingURL=typewriter.js.map