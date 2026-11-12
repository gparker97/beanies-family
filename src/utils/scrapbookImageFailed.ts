/**
 * The one diagnostic event for a scrapbook photo that failed to load and fell back to its
 * text card (`ScrapbookPiece`) or its emoji square (`MilestoneThumb`). Shared so both
 * renderers emit the identical event, and so the wall timeline, which renders both, shows
 * up under one CloudWatch filter (`surface = scrapbook`).
 *
 * These renderers read photo URLs with `ignoreUnresolved` and keep their own `failed`
 * state, so this event is the only record of the failure: it never marks the photo
 * unresolved in `photoStore` (a wall session lasts weeks, and one failed `<img>` would
 * otherwise blank that photo everywhere for the whole session).
 *
 * Once per photo per local day per online state: a polaroid that fails falls back to a thumb
 * of the same photo, which would otherwise log it twice, and a wall timeline remounts its
 * cards all day. The key carries the day, so a wall open for weeks still logs a photo that is
 * still failing tomorrow, and the online state, so going offline does not hide a real fault.
 *
 * Context is allowlisted keys only: `file_id_tail` (the last four characters of the Drive
 * file id, enough to correlate with a Drive-side report) and `online` (an offline device
 * explains most failures on its own).
 */
import { logEvent } from '@/services/telemetry/logEvent';
import { tail } from '@/utils/diagnostics';
import { toDateInputValue } from '@/utils/date';

/** Keys logged today; cleared when the local day changes, so it never grows for weeks. */
let loggedDay = '';
const logged = new Set<string>();

export function logScrapbookImageFailed(
  photoId: string,
  driveFileId: string | null | undefined
): void {
  const day = toDateInputValue(new Date());
  if (day !== loggedDay) {
    loggedDay = day;
    logged.clear();
  }
  const online = typeof navigator === 'undefined' ? null : navigator.onLine;
  const key = `${photoId}:${online}`;
  if (logged.has(key)) return;
  logged.add(key);
  logEvent({
    level: 'warn',
    surface: 'scrapbook',
    message: 'scrapbook_image_failed',
    context: {
      file_id_tail: tail(driveFileId),
      online,
    },
  });
}

/** Test-only: forget which photos have logged. */
export function __resetScrapbookImageFailedForTests(): void {
  logged.clear();
  loggedDay = '';
}
