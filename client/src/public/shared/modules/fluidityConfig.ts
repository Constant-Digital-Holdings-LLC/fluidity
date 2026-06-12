import type { LoggerConfig } from '#@shared/modules/logger.js';
import { ConfigData, FSConfigUtil, DOMConfigUtil, isConfigDataPopulated } from '#@shared/modules/config.js';
import type { FluidityPacket, PublishTarget } from '#@shared/types.js';

//
// Application Specific Customizations of
// Configuration Lib Below:
//
export interface MyConfigData extends ConfigData, LoggerConfig {
    readonly org?: string;
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly permittedKeys?: string[];
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
    readonly maxClientHistory?: number;
    readonly maxServerHistory?: number;
}

//appVersion here is only a fallback: on node, confFromFS reads the real
//version from the repo package.json; the browser receives it from the server
const DEFAULTS: MyConfigData = {
    appName: 'Fluidity',
    appVersion: '2.0.0'
};

const versionFromPackageJson = async (): Promise<string | undefined> => {
    try {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        //compiled location: client/dist/public/shared/modules/ -> repo root
        const pkgPath = fileURLToPath(new URL('../../../../../package.json', import.meta.url));
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
        return typeof pkg.version === 'string' && pkg.version ? pkg.version : undefined;
    } catch {
        return undefined;
    }
};

// config props which can be exposed to the client (browswer):
// note: DOM dataset values always arrive as strings - numeric props like
// maxClientHistory must be Number()ed at the point of use
export const pubSafe = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv', 'org', 'maxClientHistory'] as const;

// two main utils for retrieving config:
export const confFromDOM = (): MyConfigData => {
    const c = { ...DEFAULTS, ...new DOMConfigUtil<MyConfigData>().conf };
    if (isConfigDataPopulated<MyConfigData>(c)) {
        return c;
    } else {
        throw new Error('confFromDOM expected populated config');
    }
};
export const confFromFS = async (): Promise<MyConfigData> => {
    const appVersion = (await versionFromPackageJson()) ?? DEFAULTS.appVersion;
    const c = { ...DEFAULTS, appVersion, ...(await FSConfigUtil.asyncNew<MyConfigData>()).conf };
    if (isConfigDataPopulated<MyConfigData>(c)) {
        return c;
    } else {
        throw new Error('confFromFS expected populated config');
    }
};
