// iOS share target (#64). Native side: `ShareIntentPlugin.swift` + a Share Extension target.
//
// The extension writes each shared item into a shared APP GROUP container; this adapter
// reads and CLEARS them on launch and on resume. Clearing is unconditional — read-then-
// delete, even when the ingest fails — so one unreadable item cannot wedge every future
// share behind it.
//
// The extension is a separate, separately-signed Xcode target. Until it is added to the
// project the native plugin is absent, `isSupported()` is false, and this adapter is inert
// rather than throwing on every launch.

import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { base64ToFile } from '@/utils/base64ToFile';
import { reportError } from '@/utils/errorReporter';
import type { ShareAdapter } from './types';

interface SharedNativeFile {
  name: string;
  /** The SENDER's claimed MIME. Informational only — the orchestrator re-decides. */
  type: string;
  /** base64, no wrapping. */
  data: string;
}

interface ShareIntentPlugin {
  /** Read everything the extension left in the app group, then clear the container. */
  consume(): Promise<{ files: SharedNativeFile[] }>;
}

const ShareIntent = registerPlugin<ShareIntentPlugin>('ShareIntent');

export const iosShareAdapter: ShareAdapter = {
  name: 'ios',

  isSupported: () =>
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'ios' &&
    // Inert until the Share Extension target ships with its plugin.
    Capacitor.isPluginAvailable('ShareIntent'),

  start(onShare) {
    let disposed = false;
    // The first drain happens at launch; later ones follow a resume, so they are warm.
    let cold = true;

    const drain = async (): Promise<void> => {
      const coldStart = cold;
      cold = false;
      try {
        const { files } = await ShareIntent.consume();
        if (disposed || files.length === 0) return;
        onShare(
          files.map((f) => base64ToFile(f.data, f.name, f.type)),
          { platform: 'ios', coldStart }
        );
      } catch (err) {
        reportError({
          surface: 'share-target-ingest',
          message: 'ios share adapter failed to read the app group container',
          severity: 'error',
          error: err,
          context: { action: 'threw', os: 'ios' },
        });
      }
    };

    // iOS hands a share to the EXTENSION, not the app, so there is no launch event to hook:
    // the app checks the container when it becomes active. `resume` covers sharing while
    // beanies is already backgrounded.
    const listener = App.addListener('resume', () => void drain());
    void drain();

    return () => {
      disposed = true;
      void listener.then((l) => l.remove()).catch(() => undefined);
    };
  },
};
