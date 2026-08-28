/**
 * Deliver a generated file (PNG image, PDF, …) via the platform-appropriate
 * path: the native OS share sheet where the browser can attach a file, else a
 * plain download. The single delivery seam for every file export — reused by the
 * meal-plan export now and any future file export (#66 agenda).
 *
 * Classifies but never toasts/reports — the caller (View) maps the outcome to
 * telemetry + a friendly toast, so this stays pure and unit-testable. Mirrors
 * `useShareText`'s cancel-aware contract: a user dismissing the share sheet
 * (`AbortError`) is `cancelled`, NOT `failed`.
 */
export type ShareOrDownloadOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

export interface ShareOrDownloadResult {
  outcome: ShareOrDownloadOutcome;
  /** Present when `outcome === 'failed'` — the underlying error for reporting. */
  error?: unknown;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Download `blob` to the device via an object URL + a programmatic `<a download>`
 * (revoked after). The unconditional-download path — used for "Export as PDF",
 * where the conventional expectation is a file saved to the device, not the OS
 * share sheet. Returns `downloaded` or `failed` (with the error).
 */
export function downloadFile(blob: Blob, filename: string): ShareOrDownloadResult {
  let url: string | undefined;
  try {
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { outcome: 'downloaded' };
  } catch (err) {
    return { outcome: 'failed', error: err };
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
 * Share `blob` as a file where supported, otherwise download it.
 *
 * - `navigator.canShare({ files })` true → `navigator.share({ files, title })`
 *   (mobile/PWA + capable desktops). User cancels the sheet → `cancelled`.
 * - Otherwise → object-URL + programmatic `<a download>` → `downloaded`.
 * - Any real throw → `failed` (with the error), so the caller reports it once.
 */
export async function shareOrDownloadFile(
  blob: Blob,
  filename: string,
  mimeType: string,
  title: string,
  opts: {
    /**
     * Skip the OS share sheet and download directly. For deliverables the user asked to
     * SAVE (the recovery kit PDF): on share-capable desktops the sheet offered no plain
     * "save to disk", which is exactly what they wanted.
     */
    preferDownload?: boolean;
  } = {}
): Promise<ShareOrDownloadResult> {
  const file = new File([blob], filename, { type: mimeType });

  if (opts.preferDownload) {
    return downloadFile(blob, filename);
  }

  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title });
      return { outcome: 'shared' };
    } catch (err) {
      // Dismissing the share sheet is a normal user choice, not a failure.
      if (isAbortError(err)) return { outcome: 'cancelled' };
      return { outcome: 'failed', error: err };
    }
  }

  // No file-share support → download instead (shared path with "Export as PDF").
  return downloadFile(blob, filename);
}
