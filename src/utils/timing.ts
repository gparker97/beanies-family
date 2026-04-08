/** Returns a promise that resolves after `ms` milliseconds. */
export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
