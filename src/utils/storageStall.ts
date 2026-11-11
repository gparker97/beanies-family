/**
 * "This browser's storage is not answering": one reactive flag, set by the layer that
 * owns the storage (`registryDatabase.ts`) and read by ONE banner (`StorageStallBanner`).
 *
 * Why it exists (2026-11-11, greg's iPhone Safari): a leftover tab held the old database
 * connection after Website Data was cleared, so every open of the registry database hung.
 * Boot already turns that into an actionable screen (`app.initError.registryBlocked`),
 * but the sign-in flow has 38 callers that each waited 15 s and then degraded quietly,
 * so the person watched a spinner for minutes with nothing saying "close your other
 * beanies tabs". The owning layer now says so once, wherever the person is.
 *
 * Dependency-free on purpose (Vue's `ref` only): `registryDatabase.ts` is imported by
 * foundational code and must not pull stores or telemetry in through this module.
 */
import { readonly, ref } from 'vue';

const stalled = ref(false);

/** True while a storage open has been pending long enough to be abnormal. */
export const storageStalled = readonly(stalled);

export function markStorageStalled(): void {
  stalled.value = true;
}

export function clearStorageStall(): void {
  stalled.value = false;
}
