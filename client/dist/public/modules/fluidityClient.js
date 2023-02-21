import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
const conf = confFromDOM();
const log = fetchLogger(conf);
export class FluidityUI {
    renderFormatted(fArr) {
        const frag = document.createDocumentFragment();
        const stringF = (field, suggestStyle) => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('FORMATTED', 'STRINGF', `STRINGF-${suggestStyle !== null && suggestStyle !== void 0 ? suggestStyle : 0}`);
            return span;
        };
        const linkF = (field, suggestStyle) => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('FORMATTED', 'LINKF', `LINKF-${suggestStyle !== null && suggestStyle !== void 0 ? suggestStyle : 0}`);
            return span;
        };
        const dateF = (field, suggestStyle) => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('FORMATTED', 'DATEF', `DATEF-${suggestStyle !== null && suggestStyle !== void 0 ? suggestStyle : 0}`);
            return span;
        };
        fArr.forEach(f => {
            switch (f.fieldType) {
                case 'STRING':
                    frag.appendChild(stringF(f.field, f.suggestStyle));
                    break;
                case 'LINK':
                    frag.appendChild(linkF(f.field, f.suggestStyle));
                    break;
                case 'DATE':
                    frag.appendChild(dateF(f.field, f.suggestStyle));
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
        div.classList.add('fluidityPacket');
        if (fp.seq) {
            div.id = `fp-${fp.seq}`;
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
        site.classList.add('colon');
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
        site.classList.add('colon');
        colon.innerText = ':';
        div.appendChild(colon);
        div.appendChild(this.renderFormatted(fp.formattedData));
        frag.appendChild(div);
        return frag;
    }
    set(pos, fpArr) {
        const before = document.getElementById('before-data');
        const after = document.getElementById('after-data');
        const end = document.getElementById('end-data');
        fpArr.forEach(fp => {
            if (pos === 'before') {
                before === null || before === void 0 ? void 0 : before.appendChild(this.render(fp));
            }
            else if (pos === 'after') {
                after === null || after === void 0 ? void 0 : after.appendChild(this.render(fp));
            }
            end === null || end === void 0 ? void 0 : end.scrollIntoView({ behavior: 'smooth' });
        });
    }
    constructor(history) {
        var _a;
        this.history = history;
        this.demarc = (_a = history.at(-1)) === null || _a === void 0 ? void 0 : _a.seq;
        this.set('before', history);
    }
    add(fp) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.set('after', [fp]);
            }
        }
    }
}
//# sourceMappingURL=fluidityClient.js.map