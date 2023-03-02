import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket, FormattedData, FluidityLink, isFluidityLink } from '#@shared/types.js';

const conf = confFromDOM();
const log = fetchLogger(conf);

type FilterType = 'COLLECTOR' | 'SITE';

interface FilterStats {
    visibileCount: number;
    filterCount: number;
}

class FilterManager {
    private siteIndex: Map<string, Set<number>>;
    private collectorIndex: Map<string, Set<number>>;
    private sitesClicked: Set<string>;
    private collectorsClicked: Set<string>;
    public stats: FilterStats;
    private lastPacketSeq: number;

    constructor(private firstPacketSeq: number) {
        this.siteIndex = new Map();
        this.collectorIndex = new Map();
        this.sitesClicked = new Set();
        this.collectorsClicked = new Set();
        this.stats = { visibileCount: 0, filterCount: 0 };
        this.lastPacketSeq = firstPacketSeq;

        document.getElementById('container-main')?.addEventListener('click', this.clickHandler.bind(this));
    }

    public filtersClicked(): boolean {
        return Boolean(this.stats.filterCount);
    }

    public renderFilterStats() {
        const visibileCountElem = document.getElementById('visibile-count');
        const filterCountElem = document.getElementById('filter-count');
        const { visibileCount, filterCount } = this.stats;

        if (visibileCountElem && filterCountElem) {
            visibileCountElem.innerText = visibileCount
                ? visibileCount.toString()
                : (this.lastPacketSeq - this.firstPacketSeq + 1).toString();
            filterCountElem.innerText = filterCount.toString();
        }
    }

    public applyVisibility(target: HTMLDivElement | NodeListOf<Element>): void {
        const visibileByCollector = new Set<number>();
        const visibileBySite = new Set<number>();
        const visibileGlobal = new Set<number>();

        this.collectorsClicked.forEach(collector => {
            const seqs = this.collectorIndex.get(collector);
            if (seqs) {
                seqs.forEach(seq => visibileByCollector.add(seq));
            }
        });

        this.sitesClicked.forEach(site => {
            const seqs = this.siteIndex.get(site);
            if (seqs) {
                seqs.forEach(seq => visibileBySite.add(seq));
            }
        });

        if (visibileBySite.size && visibileByCollector.size) {
            visibileByCollector.forEach(cSeq => {
                if (visibileBySite.has(cSeq)) {
                    visibileGlobal.add(cSeq);
                }
            });
        } else if (visibileBySite.size) {
            visibileBySite.forEach(sSeq => {
                visibileGlobal.add(sSeq);
            });
        } else if (visibileByCollector.size) {
            visibileByCollector.forEach(cSeq => {
                visibileGlobal.add(cSeq);
            });
        }

        this.stats.visibileCount = visibileGlobal.size;
        console.debug('These packet SEQ#s should be visible:');
        console.debug(visibileGlobal);

        const applySingle = (fpElem: HTMLDivElement): void => {
            if (visibileGlobal.size) {
                if (visibileGlobal.has(parseInt(fpElem.id.substring(7)))) {
                    fpElem.classList.remove('hidden');
                } else {
                    fpElem.classList.add('hidden');
                }
            } else {
                fpElem.classList.remove('hidden');
            }
        };

        if (target instanceof HTMLDivElement) {
            applySingle(target);
        } else if (target instanceof NodeList) {
            target.forEach(element => {
                element instanceof HTMLDivElement && applySingle(element);
            });
        }
    }

    public applyVisibilityAll(): void {
        this.applyVisibility(document.querySelectorAll('.fluidity-packet'));
    }

    private loader(on: boolean): void {
        const loaderElem = document.getElementById('loader');

        if (on) {
            loaderElem?.classList.add('loader');
        } else {
            setTimeout(() => {
                loaderElem?.classList.remove('loader');
            }, 250);
        }
    }

    private clickHandler(e: MouseEvent): void {
        e.preventDefault();

        this.loader(true);

        const extractUnique = (type: FilterType, id: string): string | undefined => {
            const match = id.match(new RegExp(`(?:filter|clear)-${type.toLocaleLowerCase()}-(.*)`));

            if (Array.isArray(match) && match.length) {
                return match[1];
            }
            return;
        };
        if (e.target instanceof Element) {
            if (e.target.classList.contains('filter-link')) {
                if (e.target.previousElementSibling?.classList.contains('clear-link')) {
                    e.target.previousElementSibling.classList.remove('hidden');
                }
            }
            if (e.target.classList.contains('clear-link')) {
                e.target.classList.add('hidden');
            }

            if (e.target.classList.contains('collector-filter-link')) {
                const collector = extractUnique('COLLECTOR', e.target.id);
                collector && this.collectorsClicked.add(collector);
            }
            if (e.target.classList.contains('collector-clear-filter-link')) {
                const collector = extractUnique('COLLECTOR', e.target.id);
                collector && this.collectorsClicked.delete(collector);
            }

            if (e.target.classList.contains('site-filter-link')) {
                const site = extractUnique('SITE', e.target.id);
                site && this.sitesClicked.add(site);
            }

            if (e.target.classList.contains('site-clear-filter-link')) {
                const site = extractUnique('SITE', e.target.id);
                site && this.sitesClicked.delete(site);
            }

            this.stats.filterCount = this.sitesClicked.size + this.collectorsClicked.size;

            this.applyVisibilityAll();
            this.renderFilterStats();
            this.loader(false);
        }
    }

    private index(fp: FluidityPacket): void {
        if (fp.seq) {
            this.lastPacketSeq = fp.seq;
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

    private renderType(type: FilterType, fp: FluidityPacket): void {
        const ul = document.getElementById(`${type.toLocaleLowerCase()}-filter-list`);

        const li = document.createElement('li');
        const xIcon = document.createElement('i');
        const a = document.createElement('a');
        const typeIcon = document.createElement('i');

        xIcon.classList.add(
            'fa-solid',
            'fa-circle-xmark',
            `${type.toLocaleLowerCase()}-clear-filter-link`,
            'clear-link',
            'hidden'
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

    public renderFilterLinks(fp: FluidityPacket) {
        if (!this.collectorIndex.has(fp.plugin)) {
            //if we've never seen this collector, render filter links for it
            this.renderType('COLLECTOR', fp);
        }

        if (!this.siteIndex.has(fp.site)) {
            //if we've never seen this site, render filter links for it
            this.renderType('SITE', fp);
        }

        this.index(fp);
    }
}

export class FluidityUI {
    private demarc: number | undefined;
    private fm: FilterManager;

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

        div.classList.add('fluidity-packet');
        if (fp.seq) {
            div.id = `fp-seq-${fp.seq}`;
        }

        //setup filter manager
        this.fm.renderFilterLinks(fp);
        //apply filters to this singular element,
        //prior to DOM insertion
        this.fm.filtersClicked() && this.fm.applyVisibility(div);
        this.fm.renderFilterStats();

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
        this.fm = new FilterManager(history[0]?.seq ?? 0);

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
