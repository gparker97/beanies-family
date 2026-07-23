/**
 * The OS notification-permission surface, in one place (#55).
 *
 * Extracted so that `RemindersSettings.vue` can read live permission state
 * WITHOUT importing `useLocalNotifications` — which pulls in the whole reminder
 * scheduler and, through `useScheduledReminders`, five Pinia stores. A settings
 * panel that needs two booleans should not depend on all of that.
 *
 * State lives in module-level refs (the same singleton pattern as `useToday`)
 * rather than being returned from a composable, because `useLocalNotifications`
 * returns void, is guarded by a once-only init flag, and no-ops entirely on web.
 *
 * This and `useLocalNotifications` are the ONLY modules permitted to import
 * `@capacitor/local-notifications`.
 */
import { ref } from 'vue';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getPlatform, isNative } from '@/services/sync/capabilities';
import { reportError } from '@/utils/errorReporter';

export type NotifPermission = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'unknown';

/**
 * Live OS notification-permission state. `'unknown'` until first checked (web
 * never checks). Re-read on EVERY reschedule rather than latched, so revoking
 * permission mid-session becomes visible to both Settings and CloudWatch — a
 * latched `true` made "my reminder didn't fire" undiagnosable, because the
 * firehose kept reporting a perfectly healthy schedule.
 */
export const notificationPermission = ref<NotifPermission>('unknown');

/**
 * Live exact-alarm state. Android-only: stays `'unknown'` on iOS/web.
 *
 * `checkPermissions()` does NOT carry this — it returns `{ display }` only.
 * `exact_alarm` lives on `SettingsPermissionStatus`, returned exclusively by
 * `checkExactNotificationSetting()`. Reading it off `checkPermissions()` yields
 * `undefined` everywhere, silently.
 */
export const exactAlarmPermission = ref<'granted' | 'denied' | 'unknown'>('unknown');

/** Prompt at most once per session; checking still happens every time. */
let permissionRequested = false;

/**
 * Check the OS notification permission, optionally prompting.
 *
 * `mayPrompt` should be true only when there is actually something to remind
 * about — we don't surface an OS permission dialog to a user who has scheduled
 * nothing. Denial is NOT an error: the in-app briefing still shows every item.
 */
export async function ensureNotificationPermission(mayPrompt: boolean): Promise<boolean> {
  if (!isNative()) return false;
  try {
    let { display } = await LocalNotifications.checkPermissions();
    if (display === 'prompt' && mayPrompt && !permissionRequested) {
      permissionRequested = true;
      display = (await LocalNotifications.requestPermissions()).display;
    }
    notificationPermission.value = display as NotifPermission;
    return display === 'granted';
  } catch (e) {
    // 'unknown', NOT the stale previous value. A latched 'granted' here would
    // make the reschedule event report a permission state we never observed, and
    // would keep the Settings nudge hidden because the ref isn't 'denied' — the
    // device would look healthy while arming nothing.
    notificationPermission.value = 'unknown';
    reportError({
      surface: 'local-notifications-permission',
      severity: 'warning',
      message: 'notification permission check/request failed',
      error: e,
      context: { notif_error_stage: 'permission' },
    });
    return false;
  }
}

/**
 * Refresh {@link exactAlarmPermission}. No-op (and never a throw) off Android —
 * the plugin method does not exist there.
 */
export async function refreshExactAlarmPermission(): Promise<void> {
  if (getPlatform() !== 'android') return;
  try {
    const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting();
    exactAlarmPermission.value = exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch (e) {
    reportError({
      surface: 'local-notifications-permission',
      severity: 'warning',
      message: 'checkExactNotificationSetting failed; exact-alarm state unknown',
      error: e,
      context: { notif_error_stage: 'exact_alarm_check' },
    });
  }
}

/**
 * Send the user to the OS exact-alarm settings screen.
 *
 * Only reachable once a denial has actually been observed — never offered
 * pre-emptively. Throws on OEM builds with no such Settings activity, so the
 * caller must catch and offer the manual path in copy.
 *
 * NOTE: the plugin documents that flipping this setting granted→denied restarts
 * the app and DELETES every exact-alarm notification, so the caller must
 * reconcile the pending set after the round-trip either way.
 */
export async function openExactAlarmSettings(): Promise<void> {
  const { exact_alarm } = await LocalNotifications.changeExactNotificationSetting();
  exactAlarmPermission.value = exact_alarm === 'granted' ? 'granted' : 'denied';
}

/** Test-only — reset module state between cases. */
export function __resetNotificationPermissionForTesting(): void {
  notificationPermission.value = 'unknown';
  exactAlarmPermission.value = 'unknown';
  permissionRequested = false;
}
