/**
 * The system-browser Google Picker: the ONE place that knows its wire format.
 *
 * Google documents a Picker that is explicitly not an iframe — "a redirect to the Google Picker
 * within a new tab in the user's default browser" — which returns `picked_file_ids` appended to an
 * OAuth redirect. That matters because the in-page iframe Picker cannot work on the installed iOS
 * app at all: its document origin is `capacitor://app.beanies.family` (fixed; `iosScheme: 'https'`
 * is silently discarded by WKWebView, see `capacitor.config.ts`), which Google can neither validate
 * as a JavaScript origin nor use for the developer-key `Referer` check, so the frame never calls
 * back. On iOS Safari, ITP partitions the same frame's storage after the trip through
 * `accounts.google.com`, which iOS always takes because redirect auth is forced there.
 *
 * ⚠️ WHY THIS IS ITS OWN MODULE. The return arrives on TWO transports — the web
 * `/oauth/callback` page and the native `appUrlOpen` handler inside `googleAuth` — and each would
 * otherwise hand-write the same key and the same payload shape. Two copies of one wire format is
 * drift by construction; the identical mistake had to be fixed twice already for the
 * `=== 'calendar'` literal (`redirectState.ts` and the native stash). One `stashPickerSelection`
 * called from both sites removes the class.
 *
 * ⚠️ THIS MODULE MUST STAY A LEAF. `googleAuth.ts` imports `stashPickerSelection`, and `googleAuth`
 * is imported by most of the app, so ANY runtime import from here back into the Google service
 * graph is an import cycle. `PickBeanpodFileResult` therefore arrives as an `import type`: a value
 * import from `drivePicker` would be a real cycle, because `drivePicker` imports `googleAuth` at
 * runtime (`googleAuth → pickerRedirect → drivePicker → googleAuth`). `import type` is erased.
 *
 * It also deliberately does NOT live in `drivePicker.ts`. That is the gapi-iframe module, and it is
 * the file that should shrink or disappear if this mechanism wins; coupling the winner to it would
 * make either outcome a messy deletion instead of a clean one.
 */
// ⚠️ THE BARREL, matching `drivePicker` and `googleAuth`. The deep `@/services/telemetry/logEvent`
// path is the one module in this directory that nothing mocks, so importing it here dragged the
// real telemetry chain into every googleAuth test and broke their Capacitor mocks.
import { logEvent } from '@/services/telemetry';
import { platformContext } from '@/utils/platformLabel';
import type { PickBeanpodFileResult } from './drivePicker';

/**
 * Where a picker return is parked between the redirect landing and the next `pick()`.
 *
 * Namespaced alongside the two auth grants' code keys (`beanies_redirect_auth_code` and its
 * calendar sibling) so all three redirect slots are greppable together and cannot collide. Declared
 * HERE rather than derived from them, because this one holds a file id list, not a code.
 */
export const PICKER_REDIRECT_RESULT_KEY = 'beanies_redirect_auth_code:picker';

/**
 * How long a parked selection stays usable.
 *
 * ⚠️ WITHOUT THIS BOUND A SELECTION CAN BE CONSUMED TWICE OVER. The join flow often completes via
 * the direct read on return (the grant now exists, so `resolveWithoutPicker` succeeds and `pick()`
 * short-circuits before consuming). That leaves a live value behind, which a later `pick()` in the
 * same tab would then swallow as a fresh selection and silently load the wrong file.
 */
const PICKER_RETURN_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Google's `picked_file_ids` is documented as a comma-separated list. ONE parser, because the
 * delimiter appearing in two places is how a future change to it gets half-applied.
 */
function parseIds(raw: string): string[] {
  return raw.split(',').filter(Boolean);
}

interface PickerStash {
  /** The raw `picked_file_ids` param, verbatim. Comma-separated per Google's spec. */
  ids: string;
  ts: number;
}

/**
 * Event vocabulary, pinned so seven hand-typed strings across three files cannot drift into an
 * eighth spelling. `logEvent`'s `surface` is a free string, so nothing else enforces this.
 */
export const PICKER_EVENTS = {
  surface: 'system-browser-picker',
  start: 'picker_redirect_start',
  // ⚠️ WEB AND NATIVE ARE SEPARATE ACTIONS ON PURPOSE. Collapsing them into one
  // `picker_redirect_returned` loses precisely the distinction this whole spike exists to
  // establish: whether a return arrived through `/oauth/callback` (Safari/PWA) or through
  // `appUrlOpen` (the installed app). `os`/`detail` narrow it but cannot separate the two
  // transports on a device where both are possible.
  returnedWeb: 'picker_redirect_returned_web',
  returnedNative: 'picker_redirect_returned_native',
  cancelled: 'picker_redirect_cancelled',
  expired: 'picker_redirect_expired',
  unreadable: 'picker_redirect_unreadable',
  stashFailed: 'picker_redirect_stash_failed',
  startFailed: 'picker_redirect_start_failed',
  discardFailed: 'picker_redirect_discard_failed',
  // The picked file's name could not be resolved, so the safety-copy guard cannot be evaluated
  // and the owning layer will refuse the rebind. A rate worth watching.
  nameUnresolved: 'picker_name_unresolved',
} as const;

/**
 * Park the `picked_file_ids` a return carried. Called by BOTH return handlers.
 *
 * Returns `false` when the write failed, so the caller can report it; storage can throw in
 * private-mode and hardened browsers, and a silently dropped selection would strand the joiner on a
 * screen that looks like nothing happened. Never throws.
 *
 * A `null`/empty `idsParam` is a real outcome, not an error: it is what a cancel in Google's UI
 * looks like. It is stashed as an empty string so the consumer can tell "cancelled" apart from
 * "never went", which is the distinction the `'redirecting'` result kind exists to protect.
 */
export function stashPickerSelection(
  idsParam: string | null,
  transport: 'web' | 'native'
): boolean {
  const payload: PickerStash = { ids: idsParam ?? '', ts: Date.now() };
  try {
    sessionStorage.setItem(PICKER_REDIRECT_RESULT_KEY, JSON.stringify(payload));
    logEvent({
      level: 'info',
      surface: PICKER_EVENTS.surface,
      message: 'picker selection stashed',
      context: {
        ...platformContext(),
        action: transport === 'native' ? PICKER_EVENTS.returnedNative : PICKER_EVENTS.returnedWeb,
        count: parseIds(idsParam ?? '').length,
      },
    });
    return true;
  } catch (e) {
    console.error(
      `[pickerRedirect] could not write ${PICKER_REDIRECT_RESULT_KEY}; the picked file will be lost. ` +
        'Session storage is unavailable (private mode, or site data blocked).',
      e
    );
    logEvent({
      level: 'error',
      surface: PICKER_EVENTS.surface,
      message: 'picker selection could not be stashed',
      context: { ...platformContext(), action: PICKER_EVENTS.stashFailed },
      error: e,
    });
    return false;
  }
}

/**
 * Throw away a parked selection without acting on it.
 *
 * Exists for the account-switch case: stepping OVER a parked result rather than discarding it
 * leaves account A's file id alive for five minutes, and the next ordinary pick consumes it under
 * account B's token, binding the join to a file the new account may not even be able to read.
 */
export function discardPickerRedirectResult(): void {
  try {
    sessionStorage.removeItem(PICKER_REDIRECT_RESULT_KEY);
  } catch (e) {
    console.warn('[pickerRedirect] could not discard the parked selection', e);
    // Reaches the firehose like every other failure in this module. A discard that silently
    // fails leaves account A's selection alive for the next pick under account B's token, which
    // is the cross-account bug this function exists to prevent — so it must not be invisible.
    logEvent({
      level: 'warn',
      surface: PICKER_EVENTS.surface,
      message: 'parked picker selection could not be discarded',
      context: { ...platformContext(), action: PICKER_EVENTS.discardFailed },
      error: e,
    });
  }
}

/**
 * Take a parked selection, if one is waiting. Read-and-clear, so a re-render cannot re-consume it.
 *
 * Returns `null` for "nothing waiting, carry on normally". Every other branch is logged: an
 * unexplained disappearance here looks identical to the app ignoring the user, which is the exact
 * failure this whole mechanism exists to remove.
 */
export function consumePickerRedirectResult(): PickBeanpodFileResult | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PICKER_REDIRECT_RESULT_KEY);
    if (raw !== null) sessionStorage.removeItem(PICKER_REDIRECT_RESULT_KEY);
  } catch (e) {
    console.warn('[pickerRedirect] session storage unreadable; treating as no picker return', e);
    logEvent({
      level: 'warn',
      surface: PICKER_EVENTS.surface,
      message: 'picker stash unreadable',
      context: { ...platformContext(), action: PICKER_EVENTS.unreadable },
      error: e,
    });
    return null;
  }
  if (raw === null) return null;

  let stash: PickerStash;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    const obj = parsed as Partial<PickerStash>;
    if (typeof obj.ids !== 'string' || typeof obj.ts !== 'number') {
      throw new Error('missing ids/ts');
    }
    stash = { ids: obj.ids, ts: obj.ts };
  } catch (e) {
    console.warn(
      `[pickerRedirect] ${PICKER_REDIRECT_RESULT_KEY} held an unreadable value; discarding it. ` +
        'It is written only by stashPickerSelection, so a bad value means a stale or foreign write.',
      e
    );
    logEvent({
      level: 'warn',
      surface: PICKER_EVENTS.surface,
      message: 'picker stash unparseable',
      context: { ...platformContext(), action: PICKER_EVENTS.unreadable },
      error: e,
    });
    return null;
  }

  const age = Date.now() - stash.ts;
  if (age > PICKER_RETURN_MAX_AGE_MS || age < 0) {
    logEvent({
      level: 'warn',
      surface: PICKER_EVENTS.surface,
      message: 'picker selection expired before it was consumed',
      context: { ...platformContext(), action: PICKER_EVENTS.expired },
    });
    return null;
  }

  const ids = parseIds(stash.ids);
  if (ids.length === 0) {
    // The user opened Google's picker and closed it. A real outcome that must be SAID, never a
    // silent no-op: conflating "you cancelled" with "nothing happened" is the production bug the
    // `'redirecting'` kind was introduced to prevent.
    logEvent({
      level: 'info',
      surface: PICKER_EVENTS.surface,
      message: 'picker returned with no selection',
      context: { ...platformContext(), action: PICKER_EVENTS.cancelled },
    });
    return { kind: 'cancelled' };
  }

  // `fileName` is empty by construction: the picker return carries ids only. Callers already
  // prefer the name from the invite link and tolerate a placeholder on the load path.
  return { kind: 'picked', fileId: ids[0]!, fileName: '' };
}
