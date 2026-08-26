// Android share target (#64). Native side: `ShareIntentPlugin.java`.
//
// Turns ACTION_SEND / ACTION_SEND_MULTIPLE into `File[]` and nothing else. Both delivery
// paths drain through ONE `consume()` call: a cold launch has the intent buffered by the
// plugin's `load()`, and a warm app gets a `shareReceived` event. The plugin clears what it
// hands over, so rotating the device cannot re-deliver a share that was already read.

import { Capacitor } from '@capacitor/core';
import { base64ToFile } from '@/utils/base64ToFile';
import { reportError } from '@/utils/errorReporter';
import { ShareIntent } from './shareIntentPlugin';
import type { ShareAdapter } from './types';

export const androidShareAdapter: ShareAdapter = {
  name: 'android',

  isSupported: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',

  start(onShare) {
    let disposed = false;

    const drain = async (): Promise<void> => {
      try {
        const { files, coldStart, offered, read } = await ShareIntent.consume();
        if (disposed) return;
        // Nothing pending is the COMMON case — this runs on every launch — so it is not
        // reported. But a share that offered documents and read NONE is a real failure, and
        // returning early there would mean not even the `received` denominator event fires.
        if (files.length === 0 && !(offered ?? 0)) return;
        onShare(
          files.map((f) => base64ToFile(f.data, f.name, f.type)),
          {
            platform: 'android',
            coldStart: coldStart ?? false,
            // Non-zero when the native side could not read everything the sender offered
            // (unreadable provider, over the size cap, past the item cap).
            unreadable: Math.max(0, (offered ?? files.length) - (read ?? files.length)),
          }
        );
      } catch (err) {
        // A rejection inside a native listener escapes Vue's error handler entirely, so
        // without this the share would vanish with the user told nothing.
        reportError({
          surface: 'share-target-ingest',
          message: 'android share adapter failed to read the shared documents',
          severity: 'error',
          error: err,
          context: { action: 'threw', os: 'android' },
        });
      }
    };

    // Warm delivery.
    const listener = ShareIntent.addListener('shareReceived', () => void drain());
    // Cold delivery: whatever the plugin buffered before the WebView was listening.
    void drain();

    return () => {
      disposed = true;
      void listener.then((l) => l.remove()).catch(() => undefined);
    };
  },
};
