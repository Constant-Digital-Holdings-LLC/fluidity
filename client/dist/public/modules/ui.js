import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { isFluidityLink } from '#@shared/types.js';
const conf = confFromDOM();
const log = fetchLogger(conf);
export class FluidityUI {
    renderFormatted(fArr) {
        const frag = document.createDocumentFragment();
        const stringF = (field, suggestStyle = 0) => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('fp-formatted', 'fp-stringf', `fp-stringf-${suggestStyle}`);
            return span;
        };
        const linkF = (field, suggestStyle = 0) => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('fp-formatted', 'fp-linkf', `fp-linkf-${suggestStyle}`);
            return span;
        };
        const dateF = (field, suggestStyle = 0) => {
            const span = document.createElement('span');
            span.innerText = new Date(field).toLocaleTimeString();
            span.classList.add('fp-formatted', 'fp-datef', `fp-datef-${suggestStyle}`);
            return span;
        };
        fArr.forEach(f => {
            switch (f.fieldType) {
                case 'STRING':
                    typeof f.field === 'string' && frag.appendChild(stringF(f.field, f.suggestStyle));
                    break;
                case 'LINK':
                    isFluidityLink(f.field) && frag.appendChild(linkF(f.field, f.suggestStyle));
                    break;
                case 'DATE':
                    typeof f.field === 'number' && frag.appendChild(dateF(f.field, f.suggestStyle));
                    break;
                default:
                    frag.appendChild(stringF(JSON.stringify(f.field)));
            }
        });
        return frag;
    }
    render(fp) {
        const frag = document.createDocumentFragment();
        const div = document.createElement('div');
        div.classList.add('fluidity-packet');
        if (fp.seq) {
            div.id = `fp-seq-${fp.seq}`;
        }
        const oBracket = document.createElement('span');
        oBracket.classList.add('bracket');
        oBracket.innerText = '[';
        div.appendChild(oBracket);
        const site = document.createElement('span');
        site.classList.add('site');
        site.innerText = fp.site;
        div.appendChild(site);
        const dash = document.createElement('span');
        dash.classList.add('dash');
        dash.innerText = '-';
        div.appendChild(dash);
        const description = document.createElement('span');
        description.classList.add('description');
        description.innerText = fp.description;
        div.appendChild(description);
        const cBracket = document.createElement('span');
        cBracket.classList.add('bracket');
        cBracket.innerText = ']';
        div.appendChild(cBracket);
        const colon = document.createElement('span');
        colon.classList.add('colon');
        colon.innerText = ':';
        div.appendChild(colon);
        div.appendChild(this.renderFormatted(fp.formattedData));
        frag.appendChild(div);
        return frag;
    }
    set(pos, fpArr) {
        const history = document.getElementById('history-data');
        const current = document.getElementById('current-data');
        const end = document.getElementById('end-data');
        fpArr.forEach(fp => {
            if (pos === 'history') {
                history === null || history === void 0 ? void 0 : history.appendChild(this.render(fp));
            }
            else if (pos === 'current') {
                current === null || current === void 0 ? void 0 : current.appendChild(this.render(fp));
            }
            end === null || end === void 0 ? void 0 : end.scrollIntoView({ behavior: 'smooth' });
        });
    }
    constructor(history) {
        var _a;
        this.history = history;
        this.demarc = (_a = history.at(-1)) === null || _a === void 0 ? void 0 : _a.seq;
        this.set('history', history);
    }
    add(fp) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.set('current', [fp]);
            }
        }
    }
}
//# sourceMappingURL=ui.js.map