import { TermCaps } from './caps.js';
import { UIState } from './uiModel.js';
export declare const composeFrame: (st: UIState, caps: TermCaps) => string[];
export declare const enterScreen: (out: NodeJS.WriteStream) => void;
export declare const leaveScreen: (out: NodeJS.WriteStream) => void;
export declare const drawFrame: (out: NodeJS.WriteStream, lines: string[]) => void;
//# sourceMappingURL=screen.d.ts.map