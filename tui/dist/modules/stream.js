import { follow } from './transport.js';
import { matchesFilters } from './filters.js';
import { renderLine } from './renderLine.js';
export const runStream = (o) => {
    const emit = (p) => {
        if (!matchesFilters(p, o.filters))
            return;
        o.out(o.json ? JSON.stringify(p) : renderLine(p, o.render));
    };
    return follow(o.base, {
        ...(o.backoffBaseMs !== undefined ? { backoffBaseMs: o.backoffBaseMs } : {}),
        ...(o.insecure !== undefined ? { insecure: o.insecure } : {})
    }, {
        onHistory: packets => (o.historyLimit === 0 ? [] : packets.slice(-o.historyLimit)).forEach(emit),
        onPacket: emit,
        onState: o.status,
        ...(o.onMalformed !== undefined ? { onMalformed: o.onMalformed } : {})
    });
};
//# sourceMappingURL=stream.js.map