import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromDOM } from '#@shared/modules/fluidityConfig.js';
import { FluidityClient } from './modules/fluidityClient.js';
const lunr = window.lunr;
const conf = confFromDOM();
if (!conf)
    throw new Error('Missing Fluidity Client Config');
const log = fetchLogger(conf);
log.debug(conf);
const fc = new FluidityClient();
fc.sayHi();
var documents = [
    {
        name: 'Lunr',
        text: 'Like Solr, but much smaller, and not as bright.'
    },
    {
        name: 'React',
        text: 'A JavaScript library for building user interfaces.'
    },
    {
        name: 'Lodash',
        text: 'A modern JavaScript utility library delivering modularity, performance & extras.'
    }
];
var idx = lunr(function () {
    this.ref('name');
    this.field('text');
    documents.forEach(function (doc) {
        this.add(doc);
    }, this);
});
log.info(idx.search('bright'));
//# sourceMappingURL=index.js.map