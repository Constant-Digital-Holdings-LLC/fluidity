export const inBrowser = (): Boolean => {
    return typeof window === 'object' && typeof process === 'undefined';
};
