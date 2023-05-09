import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { isFluidityLink } from '#@shared/types.js';
const conf = confFromDOM();
const log = fetchLogger(conf);
class FilterManager {
    constructor(hooks) {
        var _a;
        this.hooks = hooks;
        this.siteIndex = new Map();
        this.collectorIndex = new Map();
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
                reject(err);
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
        var _a, _b;
        const extractUnique = (type, id) => {
            const match = id.match(new RegExp(`(?:filter|clear)-${type.toLocaleLowerCase()}-(.*)`));
            if (Array.isArray(match) && match.length) {
                return match[1];
            }
            return;
        };
        if (e.target instanceof Element) {
            if (e.target.classList.contains('filter-link')) {
                e.preventDefault();
                if ((_a = e.target.previousElementSibling) === null || _a === void 0 ? void 0 : _a.classList.contains('clear-link')) {
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
                (_b = this.hooks) === null || _b === void 0 ? void 0 : _b.onLinkClick();
            }
        }
    }
    index(fp) {
        if (fp.seq) {
            if (this.siteIndex.has(fp.site)) {
                const old = this.siteIndex.get(fp.site);
                if (old) {
                    this.siteIndex.set(fp.site, old.add(fp.seq));
                }
            }
            else {
                this.siteIndex.set(fp.site, new Set([fp.seq]));
            }
            if (this.collectorIndex.has(fp.plugin)) {
                const old = this.collectorIndex.get(fp.plugin);
                if (old) {
                    this.collectorIndex.set(fp.plugin, old.add(fp.seq));
                }
            }
            else {
                this.collectorIndex.set(fp.plugin, new Set([fp.seq]));
            }
        }
    }
    renderType(type, fp) {
        const ul = document.getElementById(`${type.toLocaleLowerCase()}-filter-list`);
        const li = document.createElement('li');
        const xIcon = document.createElement('i');
        const a = document.createElement('a');
        const typeIcon = document.createElement('i');
        xIcon.classList.add('fa-solid', 'fa-circle-xmark', `${type.toLocaleLowerCase()}-clear-filter-link`, 'clear-link', 'display-none');
        a.href = '#0';
        a.classList.add(`${type.toLocaleLowerCase()}-filter-link`, 'filter-link');
        typeIcon.classList.add('fa-solid');
        if (type === 'COLLECTOR') {
            xIcon.id = `clear-collector-${fp.plugin}`;
            a.innerText = fp.plugin;
            a.id = `filter-collector-${fp.plugin}`;
            typeIcon.classList.add('fa-circle-nodes');
        }
        else if (type === 'SITE') {
            xIcon.id = `clear-site-${fp.site}`;
            a.innerText = fp.site;
            a.id = `filter-site-${fp.site}`;
            typeIcon.classList.add('fa-tower-cell');
        }
        li.appendChild(xIcon);
        li.appendChild(a);
        li.appendChild(typeIcon);
        li.classList.add('fade-in');
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
export class FluidityUI {
    constructor(history) {
        var _a, _b;
        this.history = history;
        this.highestScrollPos = 0;
        this.lastVh = window.innerHeight;
        this.demarc = (_a = history.at(-1)) === null || _a === void 0 ? void 0 : _a.seq;
        this.fm = new FilterManager({
            onLinkClick: this.scrollReset.bind(this)
        });
        this.packetSet('history', history);
        (_b = document.getElementById('logo-link')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', e => {
            e.preventDefault();
            this.autoScroll();
        });
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
        const markupStringType = (field, suggestStyle = 0) => {
            const stringFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = field;
            span.classList.add('fp-line', 'fp-string');
            if (suggestStyle >= 100) {
                span.classList.add('fp-trim', `fp-color-${suggestStyle % 10}`);
            }
            else {
                span.classList.add(`fp-color-${suggestStyle}`);
            }
            stringFrag.appendChild(span);
            return stringFrag;
        };
        const markupLinkType = (field, suggestStyle = 0) => {
            const linkFrag = document.createDocumentFragment();
            const a = document.createElement('a');
            a.href = field.location;
            a.innerText = field.name;
            a.classList.add('fp-line', 'fp-link', `fp-color-${suggestStyle}`);
            a.setAttribute('target', '_blank');
            linkFrag.appendChild(a);
            return linkFrag;
        };
        const markupDateType = (field, suggestStyle = 0) => {
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
    packetRender(fp) {
        const mainFrag = document.createDocumentFragment();
        const div = document.createElement('div');
        div.classList.add('fluidity-packet');
        if (fp.seq) {
            div.id = `fp-seq-${fp.seq}`;
        }
        this.fm.renderFilterLinks(fp);
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
    packetSet(pos, fpArr) {
        var _a;
        const history = document.getElementById('history-data');
        const current = document.getElementById('current-data');
        const maxCount = (_a = conf === null || conf === void 0 ? void 0 : conf.maxClientHistory) !== null && _a !== void 0 ? _a : 50;
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
                }
                else if (pos === 'current') {
                    if (history.childElementCount > 0) {
                        if (history.firstChild && history.childElementCount + current.childElementCount >= maxCount) {
                            history.removeChild(history.firstChild);
                        }
                    }
                    else {
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
    packetAdd(fp) {
        if (typeof this.demarc === 'number' && typeof fp.seq === 'number') {
            if (fp.seq > this.demarc) {
                this.packetSet('current', [fp]);
            }
        }
    }
}
//# sourceMappingURL=ui.js.map