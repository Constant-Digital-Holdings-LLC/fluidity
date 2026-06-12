export declare const SIP_KEY_BYTES = 16;
export declare const SIP_MAC_BYTES = 8;
export declare const siphash24: (key: Uint8Array, msg: Uint8Array) => Uint8Array;
export declare const macEqual: (a: Uint8Array, b: Uint8Array) => boolean;
export declare const sipKeyFromHex: (hex: string) => Uint8Array | null;
//# sourceMappingURL=siphash.d.ts.map