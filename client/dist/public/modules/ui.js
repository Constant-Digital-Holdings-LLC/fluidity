import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { inBrowser } from '#@shared/modules/utils.js';
import { isFluidityLink, decodeSuggestStyle } from '#@shared/types.js';
import { livenessOf } from './pulse.js';
import { typeIn } from './typewriter.js';
const conf = inBrowser() ? confFromDOM() : undefined;
const log = fetchLogger(conf);
const safeTime = (value, opts) => {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) {
        log.warn(`unparseable timestamp in packet: ${JSON.stringify(value)}`);
        return '--:--';
    }
    return opts ? d.toLocaleTimeString([], opts) : d.toLocaleTimeString();
};
class FilterManager {
    constructor(hooks) {
        var _a;
        this.hooks = hooks;
        this.siteIndex = new Map();
        this.collectorIndex = new Map();
        this.siteLastSeen = new Map();
        this.sitesClicked = new Set();
        this.collectorsClicked = new Set();
        this.filterCount = 0;
        (_a = document.getElementById('container-main')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', this.clickHandler.bind(this));
    }
    filtersClicked() {
        return Boolean(this.filterCount);
    }
    renderFilterStats() {
        const visibileCountElem = document.getElementById('visibile-count');
        const filterCountElem = document.getElementById('filter-count');
        const historyElem = document.getElementById('history-data');
        const currentElem = document.getElementById('current-data');
        if (visibileCountElem && filterCountElem && historyElem && currentElem) {
            visibileCountElem.innerText = (historyElem.childElementCount +
                currentElem.childElementCount +
                1).toString();
            filterCountElem.innerText = this.filterCount.toString();
            if (this.filterCount > 0) {
                filterCountElem.classList.add('stat-data-attention');
            }
            else {
                filterCountElem.classList.remove('stat-data-attention');
            }
        }
    }
    applyVisibility(target) {
        const visibileByCollector = new Set();
        const visibileBySite = new Set();
        const visibileGlobal = new Set();
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
        }
        else if (visibileBySite.size) {
            visibileBySite.forEach(sSeq => {
                visibileGlobal.add(sSeq);
            });
        }
        else if (visibileByCollector.size) {
            visibileByCollector.forEach(cSeq => {
                visibileGlobal.add(cSeq);
            });
        }
        const applySingle = (fpElem) => {
            if (visibileGlobal.size) {
                if (visibileGlobal.has(parseInt(fpElem.id.substring(7)))) {
                    fpElem.classList.remove('display-none');
                }
                else {
                    fpElem.classList.add('display-none');
                }
            }
            else {
                if (visibileByCollector.size && visibileBySite.size) {
                    fpElem.classList.add('display-none');
                }
                else {
                    fpElem.classList.remove('display-none');
                }
            }
        };
        if (target instanceof HTMLDivElement) {
            applySingle(target);
        }
        else if (target instanceof NodeList) {
            target.forEach(element => element instanceof HTMLDivElement && applySingle(element));
        }
    }
    applyVisibilityAll() {
        return new Promise((resolve, reject) => {
            try {
                this.applyVisibility(document.querySelectorAll('.fluidity-packet'));
                resolve();
            }
            catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }
    loader(on) {
        const loaderElem = document.getElementById('loader');
        if (on) {
            loaderElem === null || loaderElem === void 0 ? void 0 : loaderElem.classList.add('loader');
        }
        else {
            setTimeout(() => {
                loaderElem === null || loaderElem === void 0 ? void 0 : loaderElem.classList.remove('loader');
            }, 300);
        }
    }
    clickHandler(e) {
        var _a;
        const extractUnique = (type, id) => {
            const match = id.match(new RegExp(`filter-${type.toLowerCase()}-(.*)`));
            if (Array.isArray(match) && match.length) {
                return match[1];
            }
            return;
        };
        if (!(e.target instanceof Element))
            return;
        const pill = e.target.closest('li.filter-pill');
        if (!(pill instanceof Element))
            return;
        e.preventDefault();
        const link = pill.querySelector('a.filter-link');
        if (!(link instanceof Element))
            return;
        const isCollector = link.classList.contains('collector-filter-link');
        const name = extractUnique(isCollector ? 'COLLECTOR' : 'SITE', link.id);
        if (name === undefined)
            return;
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
        (_a = this.hooks) === null || _a === void 0 ? void 0 : _a.onLinkClick();
    }
    refreshLiveness(now = Date.now()) {
        for (const [site, seen] of this.siteLastSeen) {
            const dot = document.getElementById(`live-site-${site}`);
            if (!dot)
                continue;
            dot.classList.remove('live-dot--fresh', 'live-dot--recent', 'live-dot--stale');
            dot.classList.add(`live-dot--${livenessOf(seen, now)}`);
        }
    }
    indexAdd(index, key, seq) {
        const seqs = index.get(key);
        if (seqs) {
            seqs.add(seq);
        }
        else {
            index.set(key, new Set([seq]));
        }
    }
    indexRemove(index, key, seq) {
        if (key === undefined)
            return;
        const seqs = index.get(key);
        if (!seqs)
            return;
        seqs.delete(seq);
        if (!seqs.size)
            index.delete(key);
    }
    index(fp) {
        var _a;
        const seenAt = new Date(fp.ts).getTime();
        if (Number.isFinite(seenAt)) {
            const prev = (_a = this.siteLastSeen.get(fp.site)) !== null && _a !== void 0 ? _a : 0;
            if (seenAt > prev)
                this.siteLastSeen.set(fp.site, seenAt);
        }
        if (fp.seq) {
            this.indexAdd(this.siteIndex, fp.site, fp.seq);
            this.indexAdd(this.collectorIndex, fp.plugin, fp.seq);
        }
    }
    deindex(site, collector, seq) {
        if (!Number.isFinite(seq))
            return;
        this.indexRemove(this.siteIndex, site, seq);
        this.indexRemove(this.collectorIndex, collector, seq);
    }
    renderType(type, fp) {
        const unique = type === 'COLLECTOR' ? fp.plugin : fp.site;
        if (document.getElementById(`filter-${type.toLowerCase()}-${unique}`))
            return;
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
        }
        else if (type === 'SITE') {
            a.innerText = fp.site;
            a.id = `filter-site-${fp.site}`;
            typeIcon.classList.add('fa-tower-cell');
            const dot = document.createElement('span');
            dot.classList.add('live-dot');
            dot.id = `live-site-${fp.site}`;
            li.appendChild(dot);
        }
        li.appendChild(a);
        li.appendChild(typeIcon);
        li.classList.add('filter-pill', 'fade-in');
        ul === null || ul === void 0 ? void 0 : ul.appendChild(li);
    }
    renderFilterLinks(fp) {
        if (!this.collectorIndex.has(fp.plugin)) {
            this.renderType('COLLECTOR', fp);
        }
        if (!this.siteIndex.has(fp.site)) {
            this.renderType('SITE', fp);
        }
        this.index(fp);
    }
}
const TYPE_BYPASS_PER_SEC = 6;
export class FluidityUI {
    constructor(history) {
        var _a, _b, _c, _d, _e;
        this.history = history;
        this.highestScrollPos = 0;
        this.liveArrivals = [];
        this.typeFn = typeIn;
        this.now = () => performance.now();
        this.lastVh = window.innerHeight;
        this.demarc = (_b = (_a = history.at(-1)) === null || _a === void 0 ? void 0 : _a.seq) !== null && _b !== void 0 ? _b : 0;
        this.fm = new FilterManager({
            onLinkClick: this.scrollReset.bind(this)
        });
        this.packetSet('history', history);
        this.flushFrame();
        const tick = setInterval(() => this.fm.refreshLiveness(), 15000);
        (_d = (_c = tick).unref) === null || _d === void 0 ? void 0 : _d.call(_c);
        (_e = document.getElementById('logo-link')) === null || _e === void 0 ? void 0 : _e.addEventListener('click', e => {
            e.preventDefault();
            this.autoScroll();
        });
    }
    refreshLiveness(now) {
        this.fm.refreshLiveness(now);
    }
    flushFrame() {
        this.autoScrollRequest();
        this.fm.renderFilterStats();
        this.fm.refreshLiveness();
    }
    scrollReset() {
        this.highestScrollPos = 0;
        this.autoScroll();
    }
    autoScroll() {
        var _a;
        (_a = document
            .getElementById('end-data')) === null || _a === void 0 ? void 0 : _a.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    autoScrollRequest() {
        var _a;
        if (window.innerHeight !== this.lastVh) {
            this.scrollReset();
            this.lastVh = window.innerHeight;
            return;
        }
        else {
            const curScrollPos = (_a = document.getElementById('cell-data')) === null || _a === void 0 ? void 0 : _a.scrollTop;
            if (curScrollPos)
                log.debug(`current scroll pos: ${curScrollPos}`);
            if (typeof curScrollPos !== 'undefined' && curScrollPos >= this.highestScrollPos - 100) {
                log.debug('current scroll pos is greater than highest scroll pos:');
                if (curScrollPos && this.highestScrollPos) {
                    log.debug(`current scroll pos: ${curScrollPos}, highest: ${this.highestScrollPos}`);
                }
                this.highestScrollPos = curScrollPos;
                log.debug('autoScroll()');
                this.autoScroll();
            }
            else {
                log.debug('auto-scroll temp disabled due to manual scroll-back');
                return;
            }
        }
    }
    renderFormattedData(fArr) {
        const renderFormattedFrag = document.createDocumentFragment();
        const styleClasses = (suggestStyle) => {
            const { color, trim } = decodeSuggestStyle(suggestStyle);
            return trim ? [`fp-color-${color}`, 'fp-trim'] : [`fp-color-${color}`];
        };
        const markupStringType = (field, suggestStyle = 0) => {
            const stringFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = field;
            span.classList.add('fp-line', 'fp-string', ...styleClasses(suggestStyle));
            stringFrag.appendChild(span);
            return stringFrag;
        };
        const markupLinkType = (field, suggestStyle = 0) => {
            const linkFrag = document.createDocumentFragment();
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
        const markupDateType = (field, suggestStyle = 0) => {
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
    packetRender(fp) {
        const mainFrag = document.createDocumentFragment();
        const div = document.createElement('div');
        div.classList.add('fluidity-packet');
        div.dataset['site'] = fp.site;
        div.dataset['collector'] = fp.plugin;
        if (fp.seq) {
            div.id = `fp-seq-${fp.seq}`;
            div.dataset['seq'] = String(fp.seq);
        }
        this.fm.renderFilterLinks(fp);
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
    evictOldest(container) {
        const victim = container.firstChild;
        if (!victim)
            return;
        if (victim instanceof HTMLElement) {
            const { site, collector, seq } = victim.dataset;
            this.fm.deindex(site, collector, Number(seq));
        }
        container.removeChild(victim);
    }
    packetSet(pos, fpArr) {
        const history = document.getElementById('history-data');
        const current = document.getElementById('current-data');
        const maxCount = Number(conf === null || conf === void 0 ? void 0 : conf.maxClientHistory) || 4000;
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
                }
                else if (pos === 'current') {
                    if (history.childElementCount > 0) {
                        if (history.childElementCount + current.childElementCount >= maxCount) {
                            this.evictOldest(history);
                        }
                    }
                    else {
                        if (current.childElementCount >= maxCount) {
                            this.evictOldest(current);
                        }
                    }
                    current.appendChild(this.packetRender(fp));
                    if (current.lastChild instanceof HTMLElement) {
                        if (!this.floodBypass(this.now())) {
                            this.typeFn(current.lastChild);
                        }
                    }
                }
            });
        }
    }
    floodBypass(now) {
        var _a;
        this.liveArrivals.push(now);
        const cutoff = now - 1000;
        while (this.liveArrivals.length && ((_a = this.liveArrivals[0]) !== null && _a !== void 0 ? _a : 0) < cutoff) {
            this.liveArrivals.shift();
        }
        return this.liveArrivals.length > TYPE_BYPASS_PER_SEC;
    }
    resync(history) {
        var _a, _b;
        this.demarc = (_b = (_a = history.at(-1)) === null || _a === void 0 ? void 0 : _a.seq) !== null && _b !== void 0 ? _b : 0;
    }
    packetAdd(fp) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.packetSet('current', [fp]);
            }
        }
    }
}
//# sourceMappingURL=ui.js.map