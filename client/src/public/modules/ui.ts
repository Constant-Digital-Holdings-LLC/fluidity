import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityPacket, FormattedData, FluidityLink, isFluidityLink } from '#@shared/types.js';

const conf = confFromDOM();
const log = fetchLogger(conf);

type FilterType = 'COLLECTOR' | 'SITE';

interface FMHooks {
    onLinkClick: () => void;
}

class FilterManager {
    private knownSites: Set<string>;
    private knownCollectors: Set<string>;
    private sitesClicked: Set<string>;
    private collectorsClicked: Set<string>;
    private filterCount: number;

    constructor(private hooks?: FMHooks) {
        this.knownSites = new Set();
        this.knownCollectors = new Set();
        this.sitesClicked = new Set();
        this.collectorsClicked = new Set();
        this.filterCount = 0;

        document.getElementById('container-main')?.addEventListener('click', this.clickHandler.bind(this));
    }

    public filtersClicked(): boolean {
        return Boolean(this.filterCount);
    }

    public renderFilterStats() {
        const visibileCountElem = document.getElementById('visibile-count');
        const filterCountElem = document.getElementById('filter-count');
        const historyElem = document.getElementById('history-data');
        const currentElem = document.getElementById('current-data');

        if (visibileCountElem && filterCountElem && historyElem && currentElem) {
            visibileCountElem.innerText = (
                historyElem.childElementCount +
                currentElem.childElementCount +
                1
            ).toString();
            filterCountElem.innerText = this.filterCount.toString();

            if (this.filterCount > 0) {
                filterCountElem.classList.add('stat-data-attention');
            } else {
                filterCountElem.classList.remove('stat-data-attention');
            }
        }
    }

    public applyVisibility(one?: HTMLDivElement): void {
        const hide = (elem: Element) => {
            elem.classList.add('display-none');
        };

        const show = (elem: Element) => {
            elem.classList.remove('display-none');
        };

        const negate = (label: string, set: Set<string>): string => {
            let s = '';

            set.forEach(item => {
                s += `:not([data-${label}="${item}"])`;
            });

            return s;
        };

        if (!one) document.querySelectorAll('.fluidity-packet').forEach(elem => show(elem));

        if (this.sitesClicked.size && this.collectorsClicked.size) {
            //WE ARE FILTERING ON SITES AND COLLECTORS:
            if (one && one.dataset['memberSite'] && one.dataset['memberPlugin']) {
                //apply to ONE:
                if (
                    this.sitesClicked.has(one.dataset['memberSite']) &&
                    this.collectorsClicked.has(one.dataset['memberPlugin'])
                ) {
                    show(one);
                } else {
                    hide(one);
                }
            } else {
                //apply to MANY:
                this.loader(true);

                document
                    .querySelectorAll(
                        `.fluidity-packet${negate('member-site', this.sitesClicked)}, .fluidity-packet${negate(
                            'member-plugin',
                            this.collectorsClicked
                        )}`
                    )
                    .forEach(node => hide(node));
                this.loader(false);
            }
        } else if (this.sitesClicked.size) {
            //WE ARE *JUST FILTERING ON SITES:
            if (one && one.dataset['memberSite']) {
                //apply to ONE:
                if (this.sitesClicked.has(one.dataset['memberSite'])) {
                    show(one);
                } else {
                    hide(one);
                }
            } else {
                //apply to MANY:
                this.loader(true);

                document
                    .querySelectorAll(`.fluidity-packet${negate('member-site', this.sitesClicked)}`)
                    .forEach(node => hide(node));

                this.loader(false);
            }
        } else if (this.collectorsClicked.size) {
            //WE ARE *JUST FILTERING ON COLLECTORS:
            if (one && one.dataset['memberPlugin']) {
                //apply to  ONE:
                if (this.collectorsClicked.has(one.dataset['memberPlugin'])) {
                    show(one);
                } else {
                    hide(one);
                }
            } else {
                //apply to MANY:
                this.loader(true);

                document
                    .querySelectorAll(`.fluidity-packet${negate('member-plugin', this.collectorsClicked)}`)
                    .forEach(node => hide(node));

                this.loader(false);
            }
        }
    }

    private loader(on: boolean): void {
        const loaderElem = document.getElementById('loader');

        if (on) {
            loaderElem?.classList.add('loader');
        } else {
            setTimeout(() => {
                loaderElem?.classList.remove('loader');
            }, 800);
        }
    }

    private clickHandler(e: MouseEvent): void {
        const extractUnique = (type: FilterType, id: string): string | undefined => {
            const match = id.match(new RegExp(`(?:filter|clear)-${type.toLocaleLowerCase()}-(.*)`));

            if (Array.isArray(match) && match.length) {
                return match[1];
            }
            return;
        };
        if (e.target instanceof Element) {
            if (e.target.classList.contains('filter-link')) {
                e.preventDefault();
                if (e.target.previousElementSibling?.classList.contains('clear-link')) {
                    e.target.previousElementSibling.classList.remove('display-none');
                }
            }
            if (e.target.classList.contains('clear-link')) {
                e.preventDefault();
                e.target.classList.add('display-none');
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

            this.filterCount = this.sitesClicked.size + this.collectorsClicked.size;

            if (e.target.classList.contains('filter-link') || e.target.classList.contains('clear-link')) {
                this.applyVisibility();
                this.renderFilterStats();
                this.hooks?.onLinkClick();
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
            'display-none'
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
        li.classList.add('fade-in');
        ul?.appendChild(li);
    }

    public renderFilterLinks(fp: FluidityPacket) {
        if (!this.knownCollectors.has(fp.plugin)) {
            //if we've never seen this collector, render filter links for it
            this.knownCollectors.add(fp.plugin);
            this.renderType('COLLECTOR', fp);
        }

        if (!this.knownSites.has(fp.site)) {
            //if we've never seen this site, render filter links for it
            this.knownSites.add(fp.site);
            this.renderType('SITE', fp);
        }
    }
}

export class FluidityUI {
    private demarc: number | undefined;
    private fm: FilterManager;
    private highestScrollPos = 0;
    private lastVh: number;

    constructor(protected history: FluidityPacket[]) {
        this.lastVh = window.innerHeight;

        this.demarc = history.at(-1)?.seq;
        this.fm = new FilterManager({
            onLinkClick: () => {
                this.highestScrollPos = 0;
                this.autoScroll();
            }
        });

        this.packetSet('history', history);

        document.getElementById('logo-link')?.addEventListener('click', e => {
            e.preventDefault();
            this.autoScroll();
        });
    }

    private autoScroll(): void {
        document.getElementById('end-data')?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'start' });
    }

    private autoScrollRequest(): void {
        if (window.innerHeight !== this.lastVh) {
            this.highestScrollPos = 0;
            this.lastVh = window.innerHeight;
            return;
        } else {
            const curScrollPos = document.getElementById('cell-data')?.scrollTop;

            if (typeof curScrollPos !== 'undefined' && curScrollPos >= this.highestScrollPos - 100) {
                this.highestScrollPos = curScrollPos;
                this.autoScroll();
            } else {
                log.debug('auto-scroll temp disabled due to manual scroll-back');
                return;
            }
        }
    }

    protected renderFormattedData(fArr: FormattedData[]): DocumentFragment {
        const renderFormattedFrag = document.createDocumentFragment();

        const markupStringType = (field: string, suggestStyle = 0): DocumentFragment => {
            const stringFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = field;
            span.classList.add('fp-line', 'fp-string');
            //styles over 100 should use the 0-10 colors, but apply trim (no margin/no padding)
            //so 100 is color0, trimmed
            if (suggestStyle >= 100) {
                span.classList.add('fp-trim', `fp-color-${suggestStyle % 10}`);
            } else {
                span.classList.add(`fp-color-${suggestStyle}`);
            }
            stringFrag.appendChild(span);
            return stringFrag;
        };

        const markupLinkType = (field: FluidityLink, suggestStyle = 0): DocumentFragment => {
            const linkFrag = document.createDocumentFragment();
            const a = document.createElement('a');
            a.href = field.location;
            a.innerText = field.name;
            a.classList.add('fp-line', 'fp-link', `fp-color-${suggestStyle}`);
            a.setAttribute('target', '_blank');
            linkFrag.appendChild(a);
            return linkFrag;
        };

        const markupDateType = (field: string, suggestStyle = 0): DocumentFragment => {
            const dateFrag = document.createDocumentFragment();
            const span = document.createElement('span');

            span.innerText = new Date(field).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            span.classList.add('fp-line', 'fp-date', `fp-color-${suggestStyle}`);
            dateFrag.appendChild(span);
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

        div.setAttribute('data-member-site', fp.site);
        div.setAttribute('data-member-plugin', fp.plugin);

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
        // const end = document.getElementById('end-data');

        const maxCount = conf?.maxClientHistory ?? 50;

        if (history && current) {
            fpArr.forEach(fp => {
                if (pos === 'history') {
                    if (history.firstChild && history.childElementCount > maxCount) {
                        history.removeChild(history.firstChild);
                    }
                    history.appendChild(this.packetRender(fp));
                    if (history.lastChild instanceof HTMLElement) {
                        history.lastChild.classList.add('fade-in');
                    }
                } else if (pos === 'current') {
                    if (history.childElementCount > 0) {
                        if (history.firstChild && history.childElementCount + current.childElementCount >= maxCount) {
                            history.removeChild(history.firstChild);
                        }
                    } else {
                        if (current.firstChild && current.childElementCount >= maxCount) {
                            current.removeChild(current.firstChild);
                        }
                    }

                    current.appendChild(this.packetRender(fp));
                    if (current.lastChild instanceof HTMLElement) {
                        current.lastChild.classList.add('fade-in');
                    }
                }

                this.autoScrollRequest();
            });
        }
    }

    public packetAdd(fp: FluidityPacket) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.packetSet('current', [fp]);
            }
        }
    }
}
