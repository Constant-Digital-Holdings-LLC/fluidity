import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket, FormattedData, FluidityField, FluidityLink, isFluidityLink } from '#@shared/types.js';

const conf = confFromDOM();
const log = fetchLogger(conf);

export class FluidityUI {
    protected demarc: number | undefined;

    protected renderFormatted(fArr: FormattedData[]): DocumentFragment {
        const renderFormattedFrag = document.createDocumentFragment();

        const markupString = (field: string, suggestStyle = 0): DocumentFragment => {
            const stringFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = field;
            span.classList.add('fp-line', 'fp-string', `fp-color-${suggestStyle}`);
            stringFrag.appendChild(span);
            return stringFrag;
        };

        const markupLink = (field: FluidityLink, suggestStyle = 0): DocumentFragment => {
            const linkFrag = document.createDocumentFragment();
            const a = document.createElement('a');
            a.href = field.location;
            a.innerText = field.name;
            a.classList.add('fp-line', 'fp-link');
            return linkFrag;
        };

        const markupDate = (field: string, suggestStyle = 0): DocumentFragment => {
            const dateFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = new Date(field).toLocaleTimeString();
            span.classList.add('fp-line', 'fp-date', `fp-color-${suggestStyle}`);
            return dateFrag;
        };

        fArr.forEach(f => {
            switch (f.fieldType) {
                case 'STRING':
                    typeof f.field === 'string' &&
                        renderFormattedFrag.appendChild(markupString(f.field, f.suggestStyle));
                    break;
                case 'LINK':
                    isFluidityLink(f.field) && renderFormattedFrag.appendChild(markupLink(f.field, f.suggestStyle));
                    break;
                case 'DATE':
                    typeof f.field === 'string' && renderFormattedFrag.appendChild(markupDate(f.field, f.suggestStyle));
                    break;

                default:
                    renderFormattedFrag.appendChild(markupString(JSON.stringify(f.field)));
            }
        });

        return renderFormattedFrag;
    }

    protected render(fp: FluidityPacket): DocumentFragment {
        const mainFrag = document.createDocumentFragment();
        const div = document.createElement('div');
        div.classList.add('fluidity-packet');
        if (fp.seq) {
            div.id = `fp-seq-${fp.seq}`;
        }

        const oBracket = document.createElement('span');
        oBracket.classList.add('bracket-open');
        oBracket.innerText = '[';
        div.appendChild(oBracket);

        const ts = document.createElement('span');
        ts.classList.add('date');
        ts.innerText = new Date(fp.ts).toLocaleTimeString();
        div.appendChild(ts);

        // const dash = document.createElement('span');
        // dash.classList.add('dash');
        // dash.innerText = '-';
        // div.appendChild(dash);

        // const description = document.createElement('span');
        // description.classList.add('description');
        // description.innerText = fp.description;
        // div.appendChild(description);

        const cBracket = document.createElement('span');
        cBracket.classList.add('bracket-close');
        cBracket.innerText = ']';
        div.appendChild(cBracket);

        const site = document.createElement('span');
        site.classList.add('fp-line', 'site');
        site.innerText = fp.site + '(';
        div.appendChild(site);

        const description = document.createElement('span');
        description.classList.add('description');
        description.innerText = fp.description;
        div.appendChild(description);

        const closeParen = document.createElement('span');
        closeParen.classList.add('site');
        closeParen.innerText = ')';
        div.appendChild(closeParen);

        const colon = document.createElement('span');
        colon.classList.add('colon');
        colon.innerText = ':';
        div.appendChild(colon);

        div.appendChild(this.renderFormatted(fp.formattedData));

        mainFrag.appendChild(div);
        return mainFrag;
    }

    protected set(pos: 'history' | 'current', fpArr: FluidityPacket[]) {
        const history = document.getElementById('history-data');
        const current = document.getElementById('current-data');
        const end = document.getElementById('end-data');

        fpArr.forEach(fp => {
            if (pos === 'history') {
                history?.appendChild(this.render(fp));
            } else if (pos === 'current') {
                current?.appendChild(this.render(fp));
            }

            end?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    constructor(protected history: FluidityPacket[]) {
        this.demarc = history.at(-1)?.seq;
        this.set('history', history);
    }

    add(fp: FluidityPacket) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.set('current', [fp]);
            }
        }
    }
}
