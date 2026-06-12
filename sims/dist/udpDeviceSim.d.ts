export interface FluSimField {
    style: number;
    text: string;
}
export interface FluSimPacket {
    site: string;
    plugin: string;
    description?: string;
    deviceSeq: number;
    tsEpochSec?: number;
    fields: FluSimField[];
}
export declare const packFluPacket: (p: FluSimPacket) => Buffer;
export interface UdpFleetOptions {
    host?: string;
    port?: number;
    seed?: number;
    once?: boolean;
}
export interface UdpFleetHandle {
    stop(): void;
    done: Promise<void>;
}
export declare const startUdpFleet: (options?: UdpFleetOptions) => UdpFleetHandle;
//# sourceMappingURL=udpDeviceSim.d.ts.map