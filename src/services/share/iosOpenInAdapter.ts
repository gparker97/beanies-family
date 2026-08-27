// iOS "open in beanies" — the DOCUMENT-HANDLER half of the iOS share story (#64).
//
// WHY A SECOND iOS ADAPTER. iOS has two entirely separate ways to hand beanies a shared
// item, and only one of them can open the app:
//
//   - a Share Extension (`iosShareAdapter`) runs in its own process and is FORBIDDEN from
//     opening its containing app. Apple engineer, on a thread of developers trying exactly
//     that: "This isn't allowed. (We don't know why.)"
//   - a DOCUMENT TYPE (this file) is declared in the app's Info.plist, and iOS ITSELF opens
//     the app and hands over the file. No extension runs. This is the mechanism behind an
//     app that "just opens" when you share a PDF to it.
//
// So a document arrives here already in the app, with no notification hop — which is the
// behaviour we want everywhere and can only have where iOS allows it. A web URL is not a
// document and has no equivalent route, so links stay with the Share Extension.
//
// The two adapters cannot double-handle the same item: they are fed by different system
// mechanisms, and an item delivered as a document never reaches the app-group inbox that
// `iosShareAdapter` drains.

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { base64ToFile } from '@/utils/base64ToFile';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import type { ShareAdapter } from './types';

const SURFACE = 'share-target-ingest';

/** Extension → MIME, for the types declared in `CFBundleDocumentTypes`. */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
};

/** The sender's claimed type is informational only — the orchestrator re-decides. */
function mimeFor(name: string): string {
  return MIME_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

/**
 * The last path component, percent-decoded, or a fallback.
 *
 * iOS delivers a copy under `.../Documents/Inbox/`, so the name is the user's real filename
 * and worth preserving — it is what the review form shows as the source document.
 */
function fileNameFrom(url: string): string {
  const raw = url.split('?')[0].split('/').pop() ?? '';
  try {
    return decodeURIComponent(raw) || 'shared-document';
  } catch {
    // A malformed escape sequence is not worth losing the share over.
    return raw || 'shared-document';
  }
}

export const iosOpenInAdapter: ShareAdapter = {
  name: 'ios',

  isSupported: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios',

  start(onShare) {
    let disposed = false;

    const handle = async (url: string): Promise<void> => {
      // `appUrlOpen` also carries OAuth returns and custom-scheme launches. Only a FILE
      // url is ours; everything else belongs to another listener and must pass through
      // untouched.
      if (!url.startsWith('file://')) return;

      try {
        const { data } = await Filesystem.readFile({ path: url });
        if (disposed) return;
        if (typeof data !== 'string' || data.length === 0) {
          // Readable but empty: report rather than hand the orchestrator a 0-byte file
          // that would fail later with no trace of where it came from.
          reportError({
            surface: SURFACE,
            message: 'ios opened a document that read back empty',
            severity: 'error',
            context: { action: 'threw', os: 'ios', detail: 'empty_file' },
          });
          return;
        }

        const name = fileNameFrom(url);
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'ios opened a document directly',
          // `detail` distinguishes this from the extension path in the same surface, so the
          // split between the two iOS mechanisms is measurable rather than inferred.
          context: { action: 'received', os: 'ios', detail: 'open_in', file_count: 1 },
        });

        onShare(
          { files: [base64ToFile(data, name, mimeFor(name))] },
          // Always a cold-ish start from the user's point of view: iOS foregrounded the app
          // to deliver this, so there is no earlier drain to distinguish it from.
          { platform: 'ios', coldStart: true }
        );
      } catch (err) {
        // A rejection inside a native listener escapes Vue's handler entirely, so an
        // unguarded throw here is a share that vanishes with the user told nothing.
        reportError({
          surface: SURFACE,
          message: 'ios could not read a document opened into the app',
          severity: 'error',
          error: err,
          context: { action: 'threw', os: 'ios', detail: 'open_in' },
        });
      }
    };

    const listener = App.addListener('appUrlOpen', (event) => void handle(event.url));

    // A COLD launch delivers the url through the launch event rather than the listener,
    // which is registered a moment too late to see it. Without this, opening beanies from
    // a share while it was not running does nothing at all.
    void App.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) void handle(launch.url);
      })
      .catch((err) =>
        reportError({
          surface: SURFACE,
          message: 'could not read the ios launch url; a cold-start document open is lost',
          severity: 'warning',
          error: err,
          context: { action: 'threw', os: 'ios', detail: 'launch_url' },
        })
      );

    return () => {
      disposed = true;
      void listener.then((l) => l.remove()).catch(() => undefined);
    };
  },
};
