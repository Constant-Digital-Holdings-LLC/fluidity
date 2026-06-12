import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { inBrowser } from '#@shared/modules/utils.js';
import { FluidityPacket, FormattedData, FluidityLink, isFluidityLink, decodeSuggestStyle } from '#@shared/types.js';
import { livenessOf } from './pulse.js';
import { typeIn } from './typewriter.js';

//in the browser, conf is injected into the DOM by the server;
//under test (node + jsdom) defaults apply
const conf = inBrowser() ? confFromDOM() : undefined;
const log = fetchLogger(conf);

//format a timestamp for display, but never render the literal "Invalid Date":
//a malformed ts/DATE field (corruption, a misbehaving plugin) falls back to a
//marker and a logged warning instead of silently corrupting the line
const safeTime = (value: string, opts?: Intl.DateTimeFormatOptions): string => {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) {
        log.warn(`unparseable timestamp in packet: ${JSON.stringify(value)}`);
        return '--:--';
    }
    return opts ? d.toLocaleTimeString([], opts) : d.toLocaleTimeString();
};

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
            //toLowerCase, not toLocaleLowerCase: these are DOM-id constants
            //('SITE' -> 'sıte' under a Turkish locale would never match)
            const match = id.match(new RegExp(`filter-${type.toLowerCase()}-(.*)`));

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

    private indexAdd(index: Map<string, Set<number>>, key: string, seq: number): void {
        const seqs = index.get(key);
        if (seqs) {
            seqs.add(seq);
        } else {
            index.set(key, new Set([seq]));
        }
    }

    private indexRemove(index: Map<string, Set<number>>, key: string | undefined, seq: number): void {
        if (key === undefined) return;
        const seqs = index.get(key);
        if (!seqs) return;
        seqs.delete(seq);
        //drop emptied sets so the maps never reference dead keys
        if (!seqs.size) index.delete(key);
    }

    private index(fp: FluidityPacket): void {
        const seenAt = new Date(fp.ts).getTime();
        if (Number.isFinite(seenAt)) {
            const prev = this.siteLastSeen.get(fp.site) ?? 0;
            if (seenAt > prev) this.siteLastSeen.set(fp.site, seenAt);
        }

        if (fp.seq) {
            this.indexAdd(this.siteIndex, fp.site, fp.seq);
            this.indexAdd(this.collectorIndex, fp.plugin, fp.seq);
        }
    }

    //eviction hook: when the UI removes a rendered packet from the DOM
    //(maxClientHistory cap), its seq must leave both indexes too, or they
    //grow one seq per packet forever while the DOM stays bounded
    public deindex(site: string | undefined, collector: string | undefined, seq: number): void {
        if (!Number.isFinite(seq)) return;
        this.indexRemove(this.siteIndex, site, seq);
        this.indexRemove(this.collectorIndex, collector, seq);
    }

    private renderType(type: FilterType, fp: FluidityPacket): void {
        //idempotent: deindexing can empty an index key while its pill stays
        //in the DOM; never render a second pill for the same site/collector
        const unique = type === 'COLLECTOR' ? fp.plugin : fp.site;
        if (document.getElementById(`filter-${type.toLowerCase()}-${unique}`)) return;

        const ul = document.getElementById(`${type.toLowerCase()}-filter-list`);

        const li = document.createElement('li');
        const a = document.createElement('a');
        const typeIcon = document.createElement('i');

        a.href = '#0';
        a.classList.add(`${type.toLowerCase()}-filter-link`, 'filter-link');
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

//above this live arrival rate the ~420cps typewriter can't finish a typical
//multi-field line before the next packet lands, so the stream would visibly
//trail real time; past it we render instantly. A trailing-1s window gives
//natural hysteresis (a burst has to actually subside to re-enable typing).
const TYPE_BYPASS_PER_SEC = 6;

export class FluidityUI {
    private demarc: number | undefined;
    private fm: FilterManager;
    private highestScrollPos = 0;
    private lastVh: number;
    private liveArrivals: number[] = [];
    //injectable so tests can assert when a live line animates vs lands instant
    protected typeFn = typeIn;
    protected now: () => number = () => performance.now();

    constructor(protected history: FluidityPacket[]) {
        this.lastVh = window.innerHeight;

        //?? 0 keeps the demarcation a number when history is empty (matches
        //resync), so packetAdd's typeof gate never drops every live packet
        this.demarc = history.at(-1)?.seq ?? 0;
        this.fm = new FilterManager({
            onLinkClick: this.scrollReset.bind(this)
        });

        this.packetSet('history', history);
        this.flushFrame();

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
        //passing undefined to a default param is the same as omitting it
        this.fm.refreshLiveness(now);
    }

    //once-per-frame work hoisted out of the per-packet hot path: scroll
    //chase, filter stats, liveness dots. The render pump calls this after
    //draining a batch; the constructor calls it once after the history load.
    //(liveness also refreshes on its own 15s timer while the stream is quiet)
    public flushFrame(): void {
        this.autoScrollRequest();
        this.fm.renderFilterStats();
        this.fm.refreshLiveness();
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

        //styles >= 100 use the 0-10 colors plus trim (no margin/no padding),
        //so 100 is color0 trimmed - the shared decode keeps all three field
        //types (and the TUI) on the same convention. CSS defines fp-color-0..10.
        const styleClasses = (suggestStyle: number): string[] => {
            const { color, trim } = decodeSuggestStyle(suggestStyle);
            return trim ? [`fp-color-${color}`, 'fp-trim'] : [`fp-color-${color}`];
        };

        const markupStringType = (field: string, suggestStyle = 0): DocumentFragment => {
            const stringFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = field;
            span.classList.add('fp-line', 'fp-string', ...styleClasses(suggestStyle));
            stringFrag.appendChild(span);
            return stringFrag;
        };

        const markupLinkType = (field: FluidityLink, suggestStyle = 0): DocumentFragment => {
            const linkFrag = document.createDocumentFragment();
            //defense in depth: the shared guard already rejects non-http(s)
            //locations at the boundary, but never hand anything else to an
            //href - render the name as plain text instead
            if (!/^https?:\/\//i.test(field.location)) {
                const span = document.createElement('span');
                span.innerText = field.name;
                span.classList.add('fp-line', 'fp-string', ...styleClasses(suggestStyle));
                linkFrag.appendChild(span);
                return linkFrag;
            }
            const a = document.createElement('a');
            a.href = field.location;
            a.innerText = field.name;
            a.classList.add('fp-line', 'fp-link', ...styleClasses(suggestStyle));
            a.setAttribute('target', '_blank');
            a.rel = 'noopener noreferrer';
            linkFrag.appendChild(a);
            return linkFrag;
        };

        const markupDateType = (field: string, suggestStyle = 0): DocumentFragment => {
            const dateFrag = document.createDocumentFragment();
            const span = document.createElement('span');

            span.innerText = safeTime(field, { hour: '2-digit', minute: '2-digit' });
            span.classList.add('fp-line', 'fp-date', ...styleClasses(suggestStyle));
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
        //eviction reads these back to deindex the packet (see evictOldest)
        div.dataset['site'] = fp.site;
        div.dataset['collector'] = fp.plugin;
        if (fp.seq) {
            div.id = `fp-seq-${fp.seq}`;
            div.dataset['seq'] = String(fp.seq);
        }

        //setup filter manager
        this.fm.renderFilterLinks(fp);
        //apply filters to this singular element,
        //prior to DOM insertion
        this.fm.filtersClicked() && this.fm.applyVisibility(div);

        const oBracket = document.createElement('span');
        oBracket.classList.add('bracket-open');
        oBracket.innerText = '[';
        div.appendChild(oBracket);

        const ts = document.createElement('span');
        ts.classList.add('date');
        ts.innerText = safeTime(fp.ts);
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

    //evict the oldest rendered packet, dropping its seq from the filter
    //indexes so index memory tracks the DOM cap instead of growing forever
    private evictOldest(container: HTMLElement): void {
        const victim = container.firstChild;
        if (!victim) return;
        if (victim instanceof HTMLElement) {
            const { site, collector, seq } = victim.dataset;
            this.fm.deindex(site, collector, Number(seq));
        }
        container.removeChild(victim);
    }

    private packetSet(pos: 'history' | 'current', fpArr: FluidityPacket[]) {
        const history = document.getElementById('history-data');
        const current = document.getElementById('current-data');
        // const end = document.getElementById('end-data');

        //pubSafe DOM dataset values arrive as strings; NaN/0 fall back
        const maxCount = Number(conf?.maxClientHistory) || 4000;

        if (history && current) {
            fpArr.forEach(fp => {
                if (pos === 'history') {
                    if (history.childElementCount > maxCount) {
                        this.evictOldest(history);
                    }
                    history.appendChild(this.packetRender(fp));
                    if (history.lastChild instanceof HTMLElement) {
                        history.lastChild.classList.add('fade-in');
                    }
                } else if (pos === 'current') {
                    if (history.childElementCount > 0) {
                        if (history.childElementCount + current.childElementCount >= maxCount) {
                            this.evictOldest(history);
                        }
                    } else {
                        if (current.childElementCount >= maxCount) {
                            this.evictOldest(current);
                        }
                    }

                    current.appendChild(this.packetRender(fp));
                    if (current.lastChild instanceof HTMLElement) {
                        //live lines type in fast (history renders instantly);
                        //but once the stream floods, skip straight to instant
                        //text so the display never trails the data. typeIn also
                        //no-ops under reduced motion or in tests (no rAF).
                        if (!this.floodBypass(this.now())) {
                            this.typeFn(current.lastChild);
                        }
                    }
                }
            });
        }
    }

    //records a live arrival and reports whether the typewriter should be
    //skipped: true once more than TYPE_BYPASS_PER_SEC packets landed in the
    //trailing second. Pure given `now`, so the threshold is unit-testable.
    private floodBypass(now: number): boolean {
        this.liveArrivals.push(now);
        const cutoff = now - 1000;
        while (this.liveArrivals.length && (this.liveArrivals[0] ?? 0) < cutoff) {
            this.liveArrivals.shift();
        }
        return this.liveArrivals.length > TYPE_BYPASS_PER_SEC;
    }

    //re-baseline the live demarcation, called after an SSE reconnect: the
    //server's seq counter resets to 1 on restart (deploy, dyno cycle, crash
    //recovery), which would leave a stale (high) demarcation silently dropping
    //every new packet until a manual reload. Re-point the gate at the current
    //server's latest seq - no history re-render, so the stream just resumes.
    //Empty new history -> 0, so the next packet (seq 1) still renders. This is
    //the web's equivalent of the TUI's seq+ts restart tolerance.
    public resync(history: FluidityPacket[]): void {
        this.demarc = history.at(-1)?.seq ?? 0;
    }

    public packetAdd(fp: FluidityPacket) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                //per-frame work (scroll/stats/liveness) happens in flushFrame,
                //called once per drained batch by the render pump
                this.packetSet('current', [fp]);
            }
        }
    }
}
