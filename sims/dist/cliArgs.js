import { pathToFileURL } from 'node:url';
export const isMain = (importMetaUrl) => process.argv[1] !== undefined && importMetaUrl === pathToFileURL(process.argv[1]).href;
export const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
};
//# sourceMappingURL=cliArgs.js.map