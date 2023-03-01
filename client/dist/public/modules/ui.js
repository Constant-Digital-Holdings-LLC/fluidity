import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { isFluidityLink } from '#@shared/types.js';
const conf = confFromDOM();
const log = fetchLogger(conf);
class FuidityFiltering {
    constructor() {
        var _a;
        this.siteIndex = new Map();
        this.collectorIndex = new Map();
        this.sitesClicked = new Set();
        this.collectorsClicked = new Set();
        (_a = document.getElementById('container-main')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', this.clickHandler.bind(this));
    }
    applyVisibility() {
        document.querySelectorAll('.fluidity-packet').forEach(element => {
            var _a, _b;
            if ((_a = this.visibileGlobal) === null || _a === void 0 ? void 0 : _a.size) {
                ((_b = this.visibileGlobal) === null || _b === void 0 ? void 0 : _b.has(parseInt(element.id.substring(7)))) || element.classList.add('hide');
            }
            else {
                element.classList.remove('hide');
            }
            element.classList.remove('new');
        });
    }
    genVisibilityData() {
        this.visibileByCollector = new Set();
        this.visibileBySite = new Set();
        this.visibileGlobal = new Set();
        this.collectorsClicked.forEach(collector => {
            const seqs = this.collectorIndex.get(collector);
            if (seqs) {
                seqs.forEach(seq => this.visibileByCollector instanceof Set && this.visibileByCollector.add(seq));
            }
        });
        this.sitesClicked.forEach(site => {
            const seqs = this.siteIndex.get(site);
            if (seqs) {
                seqs.forEach(seq => this.visibileBySite instanceof Set && this.visibileBySite.add(seq));
            }
        });
        if (this.visibileBySite.size && this.visibileByCollector.size) {
            this.visibileByCollector.forEach(cSeq => {
                var _a;
                if (this.visibileBySite instanceof Set) {
                    if (this.visibileBySite.has(cSeq)) {
                        (_a = this.visibileGlobal) === null || _a === void 0 ? void 0 : _a.add(cSeq);
                    }
                }
            });
        }
        else if (this.visibileBySite.size) {
            this.visibileBySite.forEach(sSeq => {
                if (this.visibileGlobal instanceof Set) {
                    this.visibileGlobal.add(sSeq);
                }
            });
        }
        else if (this.visibileByCollector.size) {
            this.visibileByCollector.forEach(cSeq => {
                if (this.visibileGlobal instanceof Set) {
                    this.visibileGlobal.add(cSeq);
                }
            });
        }
        console.debug('These packet SEQ#s should be visible:');
        console.debug(this.visibileGlobal);
        return this.visibileGlobal;
    }
    clickHandler(e) {
        var _a;
        e.preventDefault();
        const extractUnique = (type, id) => {
            const match = id.match(new RegExp(`(?:filter|clear)-${type.toLocaleLowerCase()}-(.*)`));
            if (Array.isArray(match) && match.length) {
                return match[1];
            }
            return;
        };
        if (e.target instanceof Element) {
            if (e.target.classList.contains('filter-link')) {
                if ((_a = e.target.previousElementSibling) === null || _a === void 0 ? void 0 : _a.classList.contains('clear-link')) {
                    e.target.previousElementSibling.classList.remove('hide');
                }
            }
            if (e.target.classList.contains('clear-link')) {
                e.target.classList.add('hide');
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
            this.genVisibilityData();
            this.applyVisibility();
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
        this.genVisibilityData();
        this.applyVisibility();
    }
    renderFilterLinks(type, fp) {
        const ul = document.getElementById(`${type.toLocaleLowerCase()}-filter-list`);
        const li = document.createElement('li');
        const xIcon = document.createElement('i');
        const a = document.createElement('a');
        const typeIcon = document.createElement('i');
        xIcon.classList.add('fa-solid', 'fa-circle-xmark', `${type.toLocaleLowerCase()}-clear-filter-link`, 'clear-link', 'hide');
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
        ul === null || ul === void 0 ? void 0 : ul.appendChild(li);
    }
    render(fp) {
        if (!this.collectorIndex.has(fp.plugin)) {
            this.renderFilterLinks('COLLECTOR', fp);
        }
        if (!this.siteIndex.has(fp.site)) {
            this.renderFilterLinks('SITE', fp);
        }
        this.index(fp);
    }
}
export class FluidityUI {
    renderFormattedData(fArr) {
        const renderFormattedFrag = document.createDocumentFragment();
        const markupStringType = (field, suggestStyle = 0) => {
            const stringFrag = document.createDocumentFragment();
            const span = document.createElement('span');
            span.innerText = field;
            span.classList.add('fp-line', 'fp-string', `fp-color-${suggestStyle}`);
            stringFrag.appendChild(span);
            return stringFrag;
        };
        const markupLinkType = (field, suggestStyle = 0) => {
            const linkFrag = document.createDocumentFragment();
            const a = document.createElement('a');
            a.href = field.location;
            a.innerText = field.name;
            a.classList.add('fp-line', 'fp-link');
            return linkFrag;
        };
        const markupDateType = (field, suggestStyle = 0) => {
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
    packetRender(fp) {
        const mainFrag = document.createDocumentFragment();
        const div = document.createElement('div');
        this.ff.render(fp);
        div.classList.add('fluidity-packet', 'new');
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
    packetSet(pos, fpArr) {
        const history = document.getElementById('history-data');
        const current = document.getElementById('current-data');
        const end = document.getElementById('end-data');
        fpArr.forEach(fp => {
            if (pos === 'history') {
                history === null || history === void 0 ? void 0 : history.appendChild(this.packetRender(fp));
            }
            else if (pos === 'current') {
                current === null || current === void 0 ? void 0 : current.appendChild(this.packetRender(fp));
            }
            end === null || end === void 0 ? void 0 : end.scrollIntoView({ behavior: 'smooth' });
        });
    }
    constructor(history) {
        var _a;
        this.history = history;
        this.demarc = (_a = history.at(-1)) === null || _a === void 0 ? void 0 : _a.seq;
        this.ff = new FuidityFiltering();
        this.packetSet('history', history);
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