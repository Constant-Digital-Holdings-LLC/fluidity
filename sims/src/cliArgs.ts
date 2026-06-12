//shared CLI plumbing for the repo's dual-use modules (importable library +
//runnable entry point): the am-I-the-entry-module check and the --flag value
//lookup, previously copy-pasted into every CLI block.

import { pathToFileURL } from 'node:url';

//true when the importing module is the script node was launched with
export const isMain = (importMetaUrl: string): boolean =>
    process.argv[1] !== undefined && importMetaUrl === pathToFileURL(process.argv[1]).href;

//value following `--name` in process.argv, or undefined when absent
export const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
};
