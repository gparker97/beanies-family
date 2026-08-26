// The ONE registration of the native `ShareIntent` plugin (#64).
//
// Both native adapters need it, and `src/services/share/index.ts` imports both statically —
// so registering inside each adapter module ran `registerPlugin('ShareIntent')` twice on
// every boot, on every platform, including plain web where neither adapter is supported.
// Capacitor answers a duplicate registration with a console warning and returns the FIRST
// registration's proxy, so the second adapter silently held the other platform's plugin and
// its declared interface described something it did not own.
//
// The interface is the UNION of what the two natives return. `coldStart` is Android-only:
// its plugin knows whether the share launched the app, because the intent is on the
// Activity. iOS cannot know — a share goes to the extension, which may run while the app is
// not, so the adapter infers it from whether this is the first drain since launch.

import { registerPlugin } from '@capacitor/core';

export interface SharedNativeFile {
  name: string;
  /** The SENDER's claimed MIME. Informational only — the orchestrator re-decides. */
  type: string;
  /** base64, no wrapping. */
  data: string;
}

export interface ShareIntentPlugin {
  /**
   * Hand over everything pending and clear it. Resolves empty when nothing is waiting.
   *
   * `offered` vs `read` is how a PARTIAL share is reported: a document the native side could
   * not resolve (unreadable provider, over the size cap, beyond the item cap) is counted
   * rather than dropped, so the app can say the share was partial instead of it looking like
   * a smaller share than it was. Android-only; absent on iOS, where the extension writes
   * files it has already read.
   */
  consume(): Promise<{
    files: SharedNativeFile[];
    coldStart?: boolean;
    offered?: number;
    read?: number;
  }>;
  addListener(
    event: 'shareReceived',
    handler: () => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const ShareIntent = registerPlugin<ShareIntentPlugin>('ShareIntent');
