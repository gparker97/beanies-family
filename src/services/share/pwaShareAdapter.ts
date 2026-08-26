// Web Share Target for the installed PWA on Android (#64).
//
// The share arrives as a POST to /share, which the app's own origin cannot handle directly —
// so `public/share-target-sw.js` (pulled in via workbox `importScripts`) intercepts it,
// stashes the files in a Cache entry, and 303s to /share?id=…. The `/share` route reads the
// stash, DELETES it, and hands the files here.
//
// This adapter is therefore driven by the route rather than by a listener: the route calls
// `deliverPwaShare`, and `start()` only records where to send it.

import { Capacitor } from '@capacitor/core';
import type { ShareAdapter } from './types';
import type { ShareMeta } from '@/composables/useSharedDocumentIngest';

type Sink = (files: File[], meta: ShareMeta) => void;

let sink: Sink | null = null;

/**
 * Called by the `/share` route once it has read and cleared the stash.
 *
 * Returns false when no sink is registered — the app shell has not mounted, which the route
 * reports rather than dropping the share.
 */
export function deliverPwaShare(files: File[]): boolean {
  if (!sink) return false;
  // A Web Share Target POST always LAUNCHES the PWA at /share, so it is always a cold start.
  sink(files, { platform: 'pwa', coldStart: true });
  return true;
}

export const pwaShareAdapter: ShareAdapter = {
  name: 'pwa',

  // Native builds have their own adapters; this is the browser/installed-PWA path only.
  isSupported: () => !Capacitor.isNativePlatform() && 'serviceWorker' in navigator,

  start(onShare) {
    sink = onShare;
    return () => {
      sink = null;
    };
  },
};
