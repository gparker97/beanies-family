/**
 * Try the dish-image candidates in order until one both FETCHES and STORES (#86).
 *
 * Lives outside `useRecipeCapture` deliberately. That file is already 646 lines and its
 * `runAttach` carried two attach concerns in one body; a bounded loop with a per-candidate
 * try/catch, a store-result check and per-branch reasons would have landed four to five levels
 * deep inside the single hardest block in the file — the one whose failure modes this issue
 * exists to make legible. Here it is flat, and unit-testable with a fake `photos` rather than
 * only reachable through a 175-line orchestrator.
 *
 * It returns a REASON and never logs. The caller owns the telemetry vocabulary so every
 * `logEvent` for this surface stays in one place.
 */
import { base64ToFile } from '@/utils/base64ToFile';
import { reportError } from '@/utils/errorReporter';
import type { ImageCandidate, ImageNoneReason, ImageSource } from '@/types/magicPayload';

/**
 * How many candidates we are willing to try.
 *
 * THREE, not five. Each failed attempt can burn the client's 15s fetch timeout, so the worst
 * case is already ~45s of background work. The recipe is saved by then and the frame shows the
 * same "photo on its way" treatment a slow upload does, so the cost is patience rather than
 * correctness — but it is why this is not simply the server's cap of 5.
 */
export const MAX_IMAGE_ATTEMPTS = 3;

export type DishAttachOutcome =
  | { ok: true; source: ImageSource; attempts: number }
  | { ok: false; reason: ImageNoneReason; errorCode?: string; attempts: number };

/** The slice of `usePhotos` this needs. Narrow on purpose, so a test can fake it in one line. */
export interface DishPhotoSink {
  canAdd: { value: boolean };
  atCap: { value: boolean };
  add: (files: File[]) => Promise<string[]>;
}

export interface AttachDishImageDeps {
  photos: DishPhotoSink;
  /**
   * Records a candidate that failed so the RETRY LADDER is visible, not just its verdict.
   *
   * Without it the one thing the firehose could not see was the feature itself: when a site's
   * og:image starts 403ing but its twitter:image still works, every capture silently burns an
   * extra round trip and CloudWatch shows only a clean success on a different rung.
   */
  onAttemptFailed?: (attempt: { source: ImageSource; errorCode?: string }) => void;
  fetchImage: (
    url: string,
    opts?: { pageUrl?: string }
  ) => Promise<{
    success: boolean;
    data?: { mime: string; dataUrl: string };
    errorCode?: string;
  }>;
  /** The page the candidates came from, sent as a `Referer`. */
  pageUrl?: string;
}

/** `image/jpeg` → `jpg`; everything else takes its subtype verbatim. */
function extensionFor(mime: string): string {
  const subtype = mime.split('/')[1] ?? 'jpg';
  return subtype === 'jpeg' ? 'jpg' : subtype;
}

export async function attachDishImage(
  recipeId: string,
  candidates: ImageCandidate[],
  deps: AttachDishImageDeps
): Promise<DishAttachOutcome> {
  if (candidates.length === 0) {
    return { ok: false, reason: 'no_candidates', attempts: 0 };
  }

  // SHORT-CIRCUIT BEFORE SPENDING ANYTHING. With cloud photos off or the per-set cap reached,
  // every byte we fetch is guaranteed to be discarded by `usePhotos.add` — so without this we
  // would burn up to three 15s round trips to store nothing, and (before #86) log nothing
  // about why. `atCap` distinguishes the two so the reason is actionable rather than generic.
  if (!deps.photos.canAdd.value) {
    return {
      ok: false,
      reason: deps.photos.atCap.value ? 'at_cap' : 'cloud_required',
      attempts: 0,
    };
  }

  let attempts = 0;
  let lastErrorCode: string | undefined;
  // Distinguishes "everything we tried failed to arrive" from "something arrived but the
  // store kept nothing" when the ladder is exhausted — they point at different fixes.
  let lastReason: ImageNoneReason = 'all_failed';

  for (const candidate of candidates.slice(0, MAX_IMAGE_ATTEMPTS)) {
    attempts += 1;
    try {
      const img = await deps.fetchImage(candidate.url, { pageUrl: deps.pageUrl });
      if (!img.success || !img.data) {
        // Not fatal — the next rung may well work. A 404 on `maxresdefault` falling through
        // to `hqdefault` is the designed-for case, not an exception.
        lastErrorCode = img.errorCode;
        deps.onAttemptFailed?.({ source: candidate.source, errorCode: img.errorCode });
        continue;
      }

      const { mime, dataUrl } = img.data;
      // `base64ToFile` takes RAW BASE64, not a data URL — handing it the whole
      // `data:…;base64,` string makes `atob` throw. `indexOf` returns -1 when there is no
      // comma at all, and `slice(0)` would do exactly that, so a malformed data URL is
      // treated as a failed candidate rather than an exception.
      const comma = dataUrl.indexOf(',');
      if (comma === -1) {
        lastErrorCode = 'malformed_data_url';
        deps.onAttemptFailed?.({ source: candidate.source, errorCode: 'malformed_data_url' });
        continue;
      }
      const payload = dataUrl.slice(comma + 1);
      // Named from the SNIFFED mime, never the URL: a filename taken from an attacker-supplied
      // path is how an svg ends up called .jpg, and `usePhotos`' accept test ORs the extension.
      const file = base64ToFile(payload, `dish-${recipeId}.${extensionFor(mime)}`, mime);

      const added = await deps.photos.add([file]);
      // CHECK THE RETURN. `usePhotos.add` resolves to `[]` when it stored nothing — a rejected
      // type, or a decode failure inside compression. Treating the call as success is how the
      // hit-rate metric this issue creates would have been poisoned from day one: an
      // `image_resolved` for a photo that does not exist. A QUEUED (offline) upload counts as
      // success — `add` returns completed and queued ids together — so an offline family gets
      // one queued photo rather than three.
      if (added.length > 0) {
        return { ok: true, source: candidate.source, attempts };
      }
      // CONTINUE, do not return. The two candidate-INDEPENDENT reasons for a refusal (cloud
      // off, at cap) were already ruled out before the loop, so every rejection reaching here
      // is per-FILE — a codec the engine could not decode, or a failed upload — which is
      // exactly the class where the next rung is likely to work. Returning here let one
      // un-storable image kill the whole ladder, removing the fallback this feature exists
      // to add.
      lastReason = 'store_rejected';
      deps.onAttemptFailed?.({ source: candidate.source, errorCode: 'store_rejected' });
    } catch (err) {
      // A throw from one candidate must not cost the others. The recipe is already saved; a
      // missing photo is cosmetic. But it must not be SILENT either — a bare catch here
      // deleted the only path by which a dish-attach stack trace reached CloudWatch, so a
      // deterministic decode bug on candidate 1 would hide behind a success on candidate 2.
      lastErrorCode = 'threw';
      lastReason = 'all_failed';
      deps.onAttemptFailed?.({ source: candidate.source, errorCode: 'threw' });
      reportError({
        surface: 'recipe-extract',
        message: 'a dish image candidate threw',
        severity: 'warning',
        error: err,
        context: { action: 'attach_failed', kind: 'dish_image', detail: candidate.source },
      });
    }
  }

  return { ok: false, reason: lastReason, errorCode: lastErrorCode, attempts };
}
