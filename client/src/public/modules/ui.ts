import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { inBrowser } from '#@shared/modules/utils.js';
import { FluidityPacket, FormattedData, FluidityLink, isFluidityLink } from '#@shared/types.js';
import { livenessOf } from './pulse.js';

//in the browser, conf is injected into the DOM by the server;
//under test (node + jsdom) defaults apply
const conf = inBrowser() ? confFromDOM() : undefined;
const log = fetchLogger(conf);

type FilterType = 'COLLECTOR' | 'SITE';

interface FMHooks {
    onLinkClick: () => void;
}

class FilterManager {
    private siteIndex: Map<string, Set<number>>;
    private collectorIndex: Map<string, Set<number>>;
    private siteLastSeen: Map<string, number>;
    private sitesClicked: Set<string>;
    private collectorsClicked: Set<string>;
    private filterCount: number;

    constructor(private hooks?: FMHooks) {
        this.siteIndex = new Map();
        this.collectorIndex = new Map();
        this.siteLastSeen = new Map();
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

        const applySingle = (fpElem: HTMLDivElement): void => {
            if (visibileGlobal.size) {
                if (visibileGlobal.has(parseInt(fpElem.id.substring(7)))) {
                    fpElem.classList.remove('display-none');
                } else {
                    fpElem.classList.add('display-none');
                }
            } else {
                if (visibileByCollector.size && visibileBySite.size) {
                    fpElem.classList.add('display-none');
                } else {
                    fpElem.classList.remove('display-none');
                }
            }
        };

        if (target instanceof HTMLDivElement) {
            applySingle(target);
        } else if (target instanceof NodeList) {
            target.forEach(element => element instanceof HTMLDivElement && applySingle(element));
        }
    }

    public applyVisibilityAll(): Promise<void> {
        //run in a microtask so we dont block main event loop
        return new Promise((resolve, reject) => {
            try {
                this.applyVisibility(document.querySelectorAll('.fluidity-packet'));
                resolve();
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private loader(on: boolean): void {
        const loaderElem = document.getElementById('loader');

        if (on) {
            loaderElem?.classList.add('loader');
        } else {
            setTimeout(() => {
                loaderElem?.classList.remove('loader');
            }, 300);
        }
    }

    //each pill is a toggle: clicking anywhere on it selects/deselects the
    //filter (same interaction model as the TUI's digit keys). Selection is
    //expressed as a class on the pill; the set algebra below is unchanged.
    private clickHandler(e: MouseEvent): void {
        const extractUnique = (type: FilterType, id: string): string | undefined => {
            const match = id.match(new RegExp(`filter-${type.toLocaleLowerCase()}-(.*)`));

            if (Array.isArray(match) && match.length) {
                return match[1];
            }
            return;
        };

        if (!(e.target instanceof Element)) return;

        const pill = e.target.closest('li.filter-pill');
        if (!(pill instanceof Element)) return;

        e.preventDefault();

        const link = pill.querySelector('a.filter-link');
        if (!(link instanceof Element)) return;

        const isCollector = link.classList.contains('collector-filter-link');
        const name = extractUnique(isCollector ? 'COLLECTOR' : 'SITE', link.id);
        if (name === undefined) return;

        const selections = isCollector ? this.collectorsClicked : this.sitesClicked;
        const nowSelected = !selections.has(name);
        nowSelected ? selections.add(name) : selections.delete(name);

        pill.classList.toggle('filter-selected', nowSelected);
        link.setAttribute('aria-pressed', String(nowSelected));

        this.filterCount = this.sitesClicked.size + this.collectorsClicked.size;

        this.loader(true);
        this.applyVisibilityAll()
            .then(() => {
                this.loader(false);
            })
            .catch(err => {
                this.loader(false);
                log.error(err);
            });
        this.renderFilterStats();
        this.hooks?.onLinkClick();
    }

    //liveness uses the packet's own timestamp (agent clock); the minute-scale
    //thresholds shrug off reasonable clock skew
    public refreshLiveness(now: number = Date.now()): void {
        for (const [site, seen] of this.siteLastSeen) {
            const dot = document.getElementById(`live-site-${site}`);
            if (!dot) continue;
            dot.classList.remove('live-dot--fresh', 'live-dot--recent', 'live-dot--stale');
            dot.classList.add(`live-dot--${livenessOf(seen, now)}`);
        }
    }

    private index(fp: FluidityPacket): void {
        const seenAt = new Date(fp.ts).getTime();
        if (Number.isFinite(seenAt)) {
            const prev = this.siteLastSeen.get(fp.site) ?? 0;
            if (seenAt > prev) this.siteLastSeen.set(fp.site, seenAt);
        }

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

    private renderType(type: FilterType, fp: FluidityPacket): void {
        const ul = document.getElementById(`${type.toLocaleLowerCase()}-filter-list`);

        const li = document.createElement('li');
        const a = document.createElement('a');
        const typeIcon = document.createElement('i');

        a.href = '#0';
        a.classList.add(`${type.toLocaleLowerCase()}-filter-link`, 'filter-link');
        a.setAttribute('role', 'button');
        a.setAttribute('aria-pressed', 'false');

        typeIcon.classList.add('fa-solid');

        if (type === 'COLLECTOR') {
            a.innerText = fp.plugin;
            a.id = `filter-collector-${fp.plugin}`;
            typeIcon.classList.add('fa-circle-nodes');
        } else if (type === 'SITE') {
            a.innerText = fp.site;
            a.id = `filter-site-${fp.site}`;
            typeIcon.classList.add('fa-tower-cell');

            //liveness dot: bright while the site reports, dimming as it goes quiet
            const dot = document.createElement('span');
            dot.classList.add('live-dot');
            dot.id = `live-site-${fp.site}`;
            li.appendChild(dot);
        }

        li.appendChild(a);
        li.appendChild(typeIcon);
        li.classList.add('filter-pill', 'fade-in');
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
    private highestScrollPos = 0;
    private lastVh: number;

    constructor(protected history: FluidityPacket[]) {
        this.lastVh = window.innerHeight;

        this.demarc = history.at(-1)?.seq;
        this.fm = new FilterManager({
            onLinkClick: this.scrollReset.bind(this)
        });

        this.packetSet('history', history);
        this.fm.refreshLiveness();

        //keep dots decaying while the stream is quiet. unref where available
        //(node/jsdom tests) so the timer never holds the process open
        const tick = setInterval(() => this.fm.refreshLiveness(), 15_000);
        (tick as unknown as { unref?: () => void }).unref?.();

        document.getElementById('logo-link')?.addEventListener('click', e => {
            e.preventDefault();
            this.autoScroll();
        });
    }

    public refreshLiveness(now?: number): void {
        now === undefined ? this.fm.refreshLiveness() : this.fm.refreshLiveness(now);
    }

    private scrollReset(): void {
        this.highestScrollPos = 0;
        this.autoScroll();
    }

    private autoScroll(): void {
        document
            .getElementById('end-data')
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    private autoScrollRequest(): void {
        if (window.innerHeight !== this.lastVh) {
            this.scrollReset();
            this.lastVh = window.innerHeight;
            return;
        } else {
            const curScrollPos = document.getElementById('cell-data')?.scrollTop;

            if (curScrollPos) log.debug(`current scroll pos: ${curScrollPos}`);

            if (typeof curScrollPos !== 'undefined' && curScrollPos >= this.highestScrollPos - 100) {
                log.debug('current scroll pos is greater than highest scroll pos:');
                if (curScrollPos && this.highestScrollPos) {
                    log.debug(`current scroll pos: ${curScrollPos}, highest: ${this.highestScrollPos}`);
                }
                this.highestScrollPos = curScrollPos;
                log.debug('autoScroll()');
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

        const maxCount = conf?.maxClientHistory ?? 4000;

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
                this.fm.refreshLiveness();
            }
        }
    }
}
