import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket, FormattedData, FluidityLink, isFluidityLink } from '#@shared/types.js';

const conf = confFromDOM();
const log = fetchLogger(conf);

class FuidityFiltering {
    private siteIndex: Map<string, Set<number>>;
    private collectorIndex: Map<string, Set<number>>;

    constructor() {
        this.siteIndex = new Map();
        this.collectorIndex = new Map();
    }

    private index(fp: FluidityPacket): void {
        if (fp.seq) {
            //index packet by site
            if (this.siteIndex.has(fp.site)) {
                const old = this.siteIndex.get(fp.site);
                if (old) {
                    this.siteIndex.set(fp.site, old.add(fp.seq));
                }
            } else {
                this.siteIndex.set(fp.site, new Set([fp.seq]));
            }
            //index packet by collector
            if (this.collectorIndex.has(fp.plugin)) {
                const old = this.collectorIndex.get(fp.plugin);
                if (old) {
                    this.collectorIndex.set(fp.plugin, old.add(fp.seq));
                }
            } else {
                this.collectorIndex.set(fp.plugin, new Set([fp.seq]));
            }
        }
    }

    private renderFilterLinks(type: 'COLLECTOR' | 'SITE', fp: FluidityPacket): void {
        const ul = document.getElementById(`${type.toLocaleLowerCase()}-filter-list`);

        const li = document.createElement('li');
        const xIcon = document.createElement('i');
        const a = document.createElement('a');
        const typeIcon = document.createElement('i');

        xIcon.classList.add(
            'fa-solid',
            'fa-circle-xmark',
            `${type.toLocaleLowerCase()}-clear-filter-link`,
            'clear-link'
        );

        a.href = '#0';
        a.classList.add(`${type.toLocaleLowerCase()}-filter-link`, 'filter-link');

        typeIcon.classList.add('fa-solid');

        if (type === 'COLLECTOR') {
            xIcon.id = `clear-collector-${fp.plugin}`;
            a.innerText = fp.plugin;
            a.id = `filter-collector-${fp.plugin}`;
            typeIcon.classList.add('fa-circle-nodes');
        } else if (type === 'SITE') {
            xIcon.id = `clear-site-${fp.site}`;
            a.innerText = fp.site;
            a.id = `filter-site-${fp.site}`;
            typeIcon.classList.add('fa-tower-cell');
        }

        li.appendChild(xIcon);
        li.appendChild(a);
        li.appendChild(typeIcon);
        ul?.appendChild(li);
    }

    public render(fp: FluidityPacket) {
        if (!this.collectorIndex.has(fp.plugin)) {
            //if we've never seen this collector, render filter links for it
            this.renderFilterLinks('COLLECTOR', fp);
        }

        if (!this.siteIndex.has(fp.site)) {
            //if we've never seen this site, render filter links for it
            this.renderFilterLinks('SITE', fp);
        }

        this.index(fp);
    }
}

export class FluidityUI {
    private demarc: number | undefined;
    private ff: FuidityFiltering;

    protected renderFormattedData(fArr: FormattedData[]): DocumentFragment {
        const renderFormattedFrag = document.createDocumentFragment();

        const markupStringType = (field: string, suggestStyle = 0): DocumentFragment => {
            const stringFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = field;
            span.classList.add('fp-line', 'fp-string', `fp-color-${suggestStyle}`);
            stringFrag.appendChild(span);
            return stringFrag;
        };

        const markupLinkType = (field: FluidityLink, suggestStyle = 0): DocumentFragment => {
            const linkFrag = document.createDocumentFragment();
            const a = document.createElement('a');
            a.href = field.location;
            a.innerText = field.name;
            a.classList.add('fp-line', 'fp-link');
            return linkFrag;
        };

        const markupDateType = (field: string, suggestStyle = 0): DocumentFragment => {
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
                        renderFormattedFrag.appendChild(markupStringType(f.field, f.suggestStyle));
                    break;
                case 'LINK':
                    isFluidityLink(f.field) && renderFormattedFrag.appendChild(markupLinkType(f.field, f.suggestStyle));
                    break;
                case 'DATE':
                    typeof f.field === 'string' &&
                        renderFormattedFrag.appendChild(markupDateType(f.field, f.suggestStyle));
                    break;

                default:
                    renderFormattedFrag.appendChild(markupStringType(JSON.stringify(f.field)));
            }
        });

        return renderFormattedFrag;
    }

    private packetRender(fp: FluidityPacket): DocumentFragment {
        const mainFrag = document.createDocumentFragment();
        const div = document.createElement('div');

        this.ff.render(fp);

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

        div.appendChild(this.renderFormattedData(fp.formattedData));

        mainFrag.appendChild(div);
        return mainFrag;
    }

    private packetSet(pos: 'history' | 'current', fpArr: FluidityPacket[]) {
        const history = document.getElementById('history-data');
        const current = document.getElementById('current-data');
        const end = document.getElementById('end-data');

        fpArr.forEach(fp => {
            if (pos === 'history') {
                history?.appendChild(this.packetRender(fp));
            } else if (pos === 'current') {
                current?.appendChild(this.packetRender(fp));
            }

            end?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    constructor(protected history: FluidityPacket[]) {
        this.demarc = history.at(-1)?.seq;
        this.ff = new FuidityFiltering();

        this.packetSet('history', history);
    }

    public packetAdd(fp: FluidityPacket) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.packetSet('current', [fp]);
            }
        }
    }
}
