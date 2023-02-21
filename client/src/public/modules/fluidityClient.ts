import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket, FormattedData, FluidityField } from '#@shared/types.js';

const conf = confFromDOM();
const log = fetchLogger(conf);

export class FluidityUI {
    protected demarc: number | undefined;

    protected renderFormatted(fArr: FormattedData[]): DocumentFragment {
        const frag = document.createDocumentFragment();

        const stringF = (field: FluidityField, suggestStyle?: number): HTMLSpanElement => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('FORMATTED', 'STRINGF', `STRINGF-${suggestStyle ?? 0}`);
            return span;
        };

        const linkF = (field: FluidityField, suggestStyle?: number): HTMLSpanElement => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('FORMATTED', 'LINKF', `LINKF-${suggestStyle ?? 0}`);
            return span;
        };

        const dateF = (field: FluidityField, suggestStyle?: number): HTMLSpanElement => {
            const span = document.createElement('span');
            span.innerText = field.toString();
            span.classList.add('FORMATTED', 'DATEF', `DATEF-${suggestStyle ?? 0}`);
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

    protected render(fp: FluidityPacket): DocumentFragment {
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
        site.classList.add('dash');
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

    protected set(pos: 'before' | 'after', fpArr: FluidityPacket[]) {
        const before = document.getElementById('before-data');
        const after = document.getElementById('after-data');
        const end = document.getElementById('end-data');

        fpArr.forEach(fp => {
            if (pos === 'before') {
                before?.appendChild(this.render(fp));
            } else if (pos === 'after') {
                after?.appendChild(this.render(fp));
            }

            end?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    constructor(protected history: FluidityPacket[]) {
        this.demarc = history.at(-1)?.seq;
        this.set('before', history);
    }

    add(fp: FluidityPacket) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.set('after', [fp]);
            }
        }
    }
}
