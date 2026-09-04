/**
 * Deliver a generated file (PNG image, PDF, .beanpod, JSON, photo) via the
 * platform-appropriate path. The single delivery seam for every file export.
 *
 * Classifies but never toasts/reports — `deliverFile.ts` (one layer up) owns the
 * telemetry, the toast and the console guidance for all callers, so this module
 * stays pure and unit-testable and never imports the UI or telemetry layers.
 * Mirrors `useShareText`'s cancel-aware contract: a user dismissing the share
 * sheet is `cancelled`, NOT `failed`.
 *
 * NATIVE (iOS/Android): there is no file-out mechanism in either WebView — no
 * `DownloadListener`, no `WKDownloadDelegate`, and `navigator.share` is not
 * implemented — so `<a download>` is silently inert there. Everything goes
 * through the OS share sheet, which is also where "Save to Files" lives.
 */
import { isNative } from '@/services/sync/capabilities';
import { blobToDataUrl } from '@/utils/blobToDataUrl';
import { sanitiseAttachmentBase } from '@/utils/sanitiseFilename';

export type ShareOrDownloadOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/**
 * Which step gave way. Reported as the `stage` context key so a failure is
 * attributable from CloudWatch without a local repro. Adding a member here
 * forces a matching entry in `STAGE_GUIDANCE` (`deliverFile.ts`) — that
 * exhaustive `Record` is what stops triage guidance drifting behind the code.
 *
 * `source` is the only one this module never sets: it belongs to callers that
 * fail BEFORE there are any bytes to deliver (a Drive fetch refused, no family
 * key). They previously reported `encode`, which sent the triager to a
 * blob-size theory for an OAuth-scope refusal.
 */
export type DeliveryStage = 'source' | 'plugin' | 'encode' | 'write' | 'share' | 'sweep' | 'anchor';

export type DeliveryMechanism = 'native-share' | 'web-share' | 'anchor';

export interface ShareOrDownloadResult {
  outcome: ShareOrDownloadOutcome;
  /**
   * `shared` or `downloaded`. Computed ONCE here so no caller re-derives it —
   * and so `cancelled` can never be mistaken for success at a destructive gate
   * (the delete-family "export my data first" step is exactly that gate).
   */
  delivered: boolean;
  mechanism?: DeliveryMechanism;
  /** Present when `outcome === 'failed'` — which step gave way. */
  stage?: DeliveryStage;
  error?: unknown;
  /**
   * Milliseconds spent PREPARING the file (encode + write) — everything the app
   * controls, deliberately excluding the time the OS share sheet sat open
   * waiting for a human. `deliverFile` records this, and only this, as the perf
   * sample: `Share.share` does not resolve until the sheet is dismissed, so
   * timing the whole call would measure user dwell time and push every share
   * past the warn floor. It is data, not telemetry, so the "seam never imports
   * telemetry" rule is untouched.
   */
  prepareMs?: number;
}

/** `Directory.Cache/shared` — see `sweepShareDir` for why it is its own folder. */
const SHARE_DIR = 'shared';

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * `@capacitor/share` rejects a dismissed sheet with a MESSAGE rather than a DOM
 * `AbortError`. Matching on a message is inherently fragile, so the caller only
 * consults this at the one stage where a cancel is possible (`share`).
 */
function isPluginCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /cancel/i.test(msg);
}

/**
 * How long a hand-off file is left alone before a sweep may delete it.
 *
 * Not a tidiness knob — it is the whole safety argument. `Share.share` resolves
 * when the CHOOSER returns, routinely BEFORE the receiving app (Gmail compose,
 * Drive upload, Files) has finished reading the stream through its FileProvider
 * grant, so deleting a file whose share has "finished" can still truncate it.
 * That is why there is no post-share `finally { deleteFile }` — and, less
 * obviously, why an unconditional sweep at the top of the NEXT delivery is not
 * safe either: two deliveries in quick succession while a multi-megabyte
 * `.beanpod` is still uploading hits exactly the same race.
 *
 * Ten minutes is far longer than any plausible in-flight read and still bounds
 * how long plaintext family data sits in the cache.
 */
const HANDOFF_TTL_MS = 10 * 60 * 1000;

/**
 * Delete hand-off files old enough that nothing can still be reading them.
 *
 * Runs at the TOP of a delivery (and from `sweepHandoffFiles` on sign-out),
 * never after a share. Collects whatever a mid-way failure left behind for
 * free. Never throws: a sweep failure must not turn a good delivery into a bad
 * one — it returns the error instead, so the caller can attribute it.
 */
async function sweepShareDir(
  Filesystem: typeof import('@capacitor/filesystem').Filesystem,
  Directory: typeof import('@capacitor/filesystem').Directory,
  opts: { all?: boolean } = {}
): Promise<{ error?: unknown }> {
  try {
    const { files } = await Filesystem.readdir({ path: SHARE_DIR, directory: Directory.Cache });
    const cutoff = Date.now() - HANDOFF_TTL_MS;
    await Promise.all(
      files.map((f) => {
        // `mtime` is absent on Android 7 and older; treat unknown as old enough
        // to delete rather than never — an undeletable file is the failure mode
        // that leaves family data at rest forever.
        const mtime = typeof f === 'string' ? undefined : f.mtime;
        if (!opts.all && mtime != null && mtime > cutoff) return Promise.resolve();
        return Filesystem.deleteFile({
          path: `${SHARE_DIR}/${typeof f === 'string' ? f : f.name}`,
          directory: Directory.Cache,
        }).catch(() => {
          /* one stubborn file must not abort the sweep */
        });
      })
    );
    return {};
  } catch (err) {
    // The folder not existing yet is the common case on a first delivery and is
    // indistinguishable from a real readdir failure here — which is why this is
    // returned rather than reported. A delivery that then SUCCEEDS says nothing
    // about it; one that fails carries the `sweep` stage.
    return { error: err };
  }
}

/**
 * Delete every hand-off file regardless of age.
 *
 * For teardown (sign-out, delete-family), where the two most sensitive
 * deliverables can otherwise sit in the cache indefinitely: the readable-JSON
 * export is the whole family in plaintext, and the recovery-kit PDF is a live
 * credential. Nothing can still be reading them at that point, so the TTL does
 * not apply. Safe to call on web and safe to call twice.
 */
export async function sweepHandoffFiles(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await sweepShareDir(Filesystem, Directory, { all: true });
  } catch {
    // Teardown must never be blocked by a cache sweep.
  }
}

/**
 * Download `blob` via an object URL + a programmatic `<a download>`.
 *
 * WEB/PWA ONLY. On native the anchor does nothing and `click()` never throws,
 * so this used to return `downloaded` for a file that was never written — the
 * root of every silent export failure in the native apps. It now refuses.
 */
export function downloadFile(blob: Blob, filename: string): ShareOrDownloadResult {
  if (isNative()) {
    return {
      outcome: 'failed',
      delivered: false,
      mechanism: 'anchor',
      stage: 'anchor',
      error: new Error(
        '<a download> does not work in a WebView — route through shareOrDownloadFile'
      ),
    };
  }

  let url: string | undefined;
  try {
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { outcome: 'downloaded', delivered: true, mechanism: 'anchor' };
  } catch (err) {
    return {
      outcome: 'failed',
      delivered: false,
      mechanism: 'anchor',
      stage: 'anchor',
      error: err,
    };
  } finally {
    // Defer the revoke: WebKit/Firefox read the blob on a task queued AFTER the
    // click returns, so revoking in the same tick aborts the download entirely.
    if (url) {
      const u = url;
      setTimeout(() => URL.revokeObjectURL(u), 10_000);
    }
  }
}

/**
 * Write the blob to the app cache and hand its `file://` uri to the OS share
 * sheet. One `try` with a `stage` cursor rather than nested blocks, so the
 * failure is attributable and the happy path reads straight down.
 */
async function nativeDeliver(
  blob: Blob,
  filename: string,
  title: string
): Promise<ShareOrDownloadResult> {
  let stage: DeliveryStage = 'plugin';
  let sweepError: unknown;
  const started = performance.now();

  try {
    // Dynamic so the plugins stay out of the web bundle and out of every
    // web-path unit test. Matches `useSheetExport`'s loadJsPdf/loadHtmlToImage.
    const { Share } = await import('@capacitor/share');
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    stage = 'sweep';
    ({ error: sweepError } = await sweepShareDir(Filesystem, Directory));

    stage = 'encode';
    // An empty blob would otherwise sail through: `blobToDataUrl` yields
    // "data:<type>;base64," for zero bytes, `.split(',')[1]` is the empty
    // string, and a 0-byte file writes and shares perfectly happily. The user
    // gets a file that opens to nothing, reported as success — and at the
    // delete-family gate that empty file is the "backup" that authorises
    // destroying the original.
    if (blob.size === 0) {
      throw new Error('refusing to deliver an empty file (0 bytes)');
    }
    // `Filesystem.writeFile` takes BARE base64 on native ("Blob data is only
    // supported on Web"), so drop the `data:` prefix.
    const base64 = (await blobToDataUrl(blob)).split(',')[1] ?? '';

    stage = 'write';
    // `sanitiseAttachmentBase` strips the extension BY DESIGN (it is shared with
    // the inbound share target, where a double extension is the attack), so
    // re-attach the original: the share sheet picks the receiving app from it,
    // and a `.beanpod` with no suffix offers the user nothing useful.
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1];
    const safeName = `${sanitiseAttachmentBase(filename)}${ext ? `.${ext.toLowerCase()}` : ''}`;
    // No `encoding` option: omitting it is what tells the plugin the data is
    // base64-encoded binary. The returned `uri` IS the `file://` URL to share —
    // verified in @capacitor/filesystem@8.1.2 that writeFile and getUri build
    // it identically, so a separate getUri call would be a wasted bridge hop.
    const { uri } = await Filesystem.writeFile({
      path: `${SHARE_DIR}/${safeName}`,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    const prepareMs = performance.now() - started; // stops BEFORE the sheet opens

    stage = 'share';
    // `dialogTitle` is the Android chooser's own header. Omitting it leaves the
    // platform default, which is untranslated English in every locale.
    await Share.share({ title, dialogTitle: title, files: [uri] });
    return { outcome: 'shared', delivered: true, mechanism: 'native-share', prepareMs };
  } catch (err) {
    if (stage === 'share' && isPluginCancel(err)) {
      return { outcome: 'cancelled', delivered: false, mechanism: 'native-share' };
    }
    return {
      outcome: 'failed',
      delivered: false,
      mechanism: 'native-share',
      // A failed sweep and a failed write nearly always share one cause (the
      // cache directory is gone or unwritable), and that is the more useful
      // triage hint — it is also the only way the `sweep` stage is ever
      // reported, since a sweep failure alone never fails a delivery.
      stage: sweepError && stage === 'write' ? 'sweep' : stage,
      error: err,
    };
  }
}

/**
 * Serialises native deliveries.
 *
 * Two overlapping deliveries break in two ways at once: the second one's sweep
 * can delete the first one's just-written file, and `@capacitor/share` rejects
 * the second call outright with "Can't share while sharing is in progress"
 * (`SharePlugin.java:137`, `SharePlugin.swift:68`) — a message that is NOT a
 * cancel, so a share the user went on to complete would be toasted and reported
 * as a failure. A double-tap on any export button is enough to hit both.
 *
 * Queuing rather than rejecting keeps every requested delivery: the second
 * sheet simply opens after the first closes. `catch` on the chain so one failed
 * delivery cannot poison every later one.
 */
let nativeQueue: Promise<unknown> = Promise.resolve();

/**
 * Share `blob` as a file where supported, otherwise download it.
 *
 * - Native → always the OS share sheet (the only mechanism that exists there).
 * - `preferDownload` → `<a download>` (web only; see below).
 * - `navigator.canShare({ files })` → `navigator.share`. Cancel → `cancelled`.
 * - Otherwise → `<a download>`.
 */
export async function shareOrDownloadFile(
  blob: Blob,
  filename: string,
  mimeType: string,
  title: string,
  opts: {
    /**
     * Skip the OS share sheet and download directly. For deliverables the user
     * asked to SAVE (the recovery kit PDF): on share-capable desktops the sheet
     * offered no plain "save to disk", which is what they wanted.
     *
     * Deliberately consulted AFTER the native check. It reads as surprising, so:
     * on native the anchor is inert, and the share sheet is where "Save to
     * Files" lives — so honouring `preferDownload` there would deliver nothing
     * at all. That inversion is why the recovery kit was the worst-affected
     * path before this change.
     */
    preferDownload?: boolean;
  } = {}
): Promise<ShareOrDownloadResult> {
  if (isNative()) {
    const run = nativeQueue.then(() => nativeDeliver(blob, filename, title));
    nativeQueue = run.catch(() => {});
    return run;
  }

  if (opts.preferDownload) {
    return downloadFile(blob, filename);
  }

  const file = new File([blob], filename, { type: mimeType });
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title });
      return { outcome: 'shared', delivered: true, mechanism: 'web-share' };
    } catch (err) {
      // Dismissing the share sheet is a normal user choice, not a failure.
      if (isAbortError(err)) {
        return { outcome: 'cancelled', delivered: false, mechanism: 'web-share' };
      }
      return {
        outcome: 'failed',
        delivered: false,
        mechanism: 'web-share',
        stage: 'share',
        error: err,
      };
    }
  }

  // No file-share support → download instead.
  return downloadFile(blob, filename);
}
