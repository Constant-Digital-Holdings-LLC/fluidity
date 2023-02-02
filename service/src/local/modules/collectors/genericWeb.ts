import { WebJSONCollector, WebJSONCollectorParams } from '#@service/modules/collectors.js';

export default class GenericWebCollector extends WebJSONCollector {
    constructor(params: WebJSONCollectorParams) {
        super(params);
    }
}
