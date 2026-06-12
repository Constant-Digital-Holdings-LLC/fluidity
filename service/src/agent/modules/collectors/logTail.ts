import { FileTailCollector, FileTailCollectorParams } from '../collectors.js';

//L1: tail a growing log file and publish each line as one STRING field. All
//the robustness (rotation, truncation, partial lines, stream UTF-8,
//start-at-EOF, fleet throttle, backpressure, dropCounts) lives in the
//FileTailCollector source base; this plugin is intentionally thin. L2 will add
//the shared line tokenizer here (override format()) - see PLAN.md.
export default class LogTailCollector extends FileTailCollector {
    constructor(params: FileTailCollectorParams) {
        super(params);
    }
}
