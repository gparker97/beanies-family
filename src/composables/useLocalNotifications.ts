import { watch } from 'vue';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { isNative, getPlatform } from '@/services/sync/capabilities';
import {
  useScheduledReminders,
  buildReminderSchedule,
  type ScheduledReminder,
} from '@/composables/useScheduledReminders';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';

/**
 * On-device local notifications for the native (Capacitor) app — ADR-029 A4.
 *
 * Schedules a reminder for each upcoming timed item (activities, travel
 * departures, timed to-dos) at (event − lead). Punctuality comes from the
 * manifest's USE_EXACT_ALARM, NOT from `allowWhileIdle` — the latter only permits
 * firing during Doze; without an exact-alarm grant the plugin silently degrades
 * to `setAndAllowWhileIdle`, which Doze batches to ~1 alarm per 9 minutes and
 * which caused the original #55 late-delivery defect. `exactAlarmState` below
 * makes that degradation visible instead of silent. The forward source + fire times
 * come from the pure `buildReminderSchedule` (`useScheduledReminders`), gated by
 * the per-device master toggle. Reminders are generated entirely ON-DEVICE from
 * already-decrypted data — beanies' servers never see the schedule.
 *
 * Strategy: cancel-all-then-reschedule (debounced) on any input/pref change —
 * correct for a family's item volumes, with no diff-state to drift. The
 * `@capacitor/local-notifications` import is confined to this module. No-op on
 * web (the in-app briefing surfaces the same items there). See ADR-029.
 */

const RESCHEDULE_DEBOUNCE_MS = 1000;
const REMINDERS_CHANNEL_ID = 'reminders';

/**
 * Map a stable string id to a positive 32-bit int — the plugin requires integer
 * notification ids, and the mapping must be stable so "cancel then reschedule"
 * re-uses the same id for the same logical reminder. FNV-1a over the string.
 */
export function stableNotificationId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 32-bit signed → positive, non-zero (0 is a valid id but reserve it out).
  return Math.abs(h | 0) || 1;
}

/**
 * Map the pure schedule to plugin payloads. `allowWhileIdle` bypasses Doze
 * batching; `channelId` targets the high-importance reminders channel (created
 * at init); `extra.kind` lets the delivered-listener tag its telemetry.
 * Exported for unit testing.
 */
export function buildScheduledNotifications(
  reminders: ScheduledReminder[]
): LocalNotificationSchema[] {
  return reminders.map((r) => ({
    id: stableNotificationId(r.id),
    title: r.title,
    body: r.body,
    schedule: { at: r.fireAt, allowWhileIdle: true },
    channelId: REMINDERS_CHANNEL_ID,
    extra: { kind: r.kind },
  }));
}

/**
 * Exact-alarm state, Android-only. `'unknown'` on iOS/web and until the first
 * successful check.
 *
 * NOTE: `checkPermissions()` does NOT carry this — it returns `{ display }` only
 * (`PermissionStatus`). `exact_alarm` lives on `SettingsPermissionStatus`,
 * returned exclusively by `checkExactNotificationSetting()`, which is documented
 * Android-only. Reading it off `checkPermissions()` yields `undefined` on every
 * platform, silently.
 */
let exactAlarmState: 'granted' | 'denied' | 'unknown' = 'unknown';

/**
 * Refresh {@link exactAlarmState}. No-op (and never a throw) off Android — the
 * plugin method does not exist there. A failure leaves the state untouched and
 * is reported rather than swallowed, so a permanently-`unknown` fleet is
 * distinguishable from a genuinely granted one.
 */
async function refreshExactAlarmState(): Promise<void> {
  if (getPlatform() !== 'android') return;
  try {
    const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting();
    exactAlarmState = exact_alarm === 'granted' ? 'granted' : 'denied';
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

let initialized = false;

/**
 * Wire on-device reminders. Call ONCE from `App.vue` setup. Idempotent. No-op on
 * web (the in-app `FamilyStatusToast` briefing already surfaces these items there).
 */
export function useLocalNotifications(): void {
  if (initialized) return;
  if (!isNative()) return;
  initialized = true;

  const { reminderInput, prefs } = useScheduledReminders();

  let permissionGranted = false;
  let permissionRequested = false;
  let channelReady = false;

  /** Create the reminders channel (idempotent). On Android O+ a notification
   *  posted to a non-existent channel is silently dropped, so this MUST run
   *  before the first schedule. */
  async function ensureChannel(): Promise<void> {
    if (channelReady) return;
    try {
      await LocalNotifications.createChannel({
        id: REMINDERS_CHANNEL_ID,
        name: 'Reminders',
        importance: 4, // HIGH — heads-up + sound, so a time-critical reminder is seen
      });
      channelReady = true;
    } catch (e) {
      reportError({
        surface: 'local-notifications-schedule',
        severity: 'warning',
        message: 'createChannel(reminders) failed; reminders may not post on Android O+',
        error: e,
        context: { notif_error_stage: 'channel' },
      });
    }
  }

  /** Resolve notification permission, prompting once. Denial is NOT an error. */
  async function ensurePermission(): Promise<boolean> {
    if (permissionGranted) return true;
    try {
      let { display } = await LocalNotifications.checkPermissions();
      if (display === 'prompt' && !permissionRequested) {
        permissionRequested = true;
        display = (await LocalNotifications.requestPermissions()).display;
      }
      permissionGranted = display === 'granted';
      if (!permissionGranted) {
        // Reminders are off — the in-app briefing still shows everything, so
        // this is information the user hasn't lost, not an error.
        logEvent({
          level: 'info',
          surface: 'local-notifications',
          message: 'notifications permission',
          context: { notif_permission: display },
        });
      }
      return permissionGranted;
    } catch (e) {
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

  // Delivered (best-effort) — closes the scheduled-vs-delivered-vs-late triage
  // loop (the original #55 defect) from CloudWatch without a local repro.
  void LocalNotifications.addListener('localNotificationReceived', (n) => {
    const kind = (n.extra as { kind?: string } | undefined)?.kind;
    logEvent({
      level: 'info',
      surface: 'local-notifications',
      message: 'notification delivered',
      context: kind ? { notif_kind: kind } : undefined,
    });
  });

  async function reschedule(): Promise<void> {
    // Fresh `now` each run — no fireAt drifts past between recompute and schedule.
    const { reminders, truncated } = buildReminderSchedule(
      reminderInput.value,
      new Date(),
      prefs.value
    );
    const toSchedule = buildScheduledNotifications(reminders);

    // Don't surface the OS permission prompt until there's actually something to
    // remind about (and we haven't been granted yet). Once granted, we still run
    // to clear stale reminders (e.g. an item got completed) even if empty now.
    if (toSchedule.length === 0 && !permissionGranted) return;

    if (!(await ensurePermission())) return;
    await ensureChannel();

    try {
      // Every pending notification is ours → cancel-all, then reschedule.
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({
          notifications: pending.notifications.map((n) => ({ id: n.id })),
        });
      }
      if (toSchedule.length > 0) {
        await LocalNotifications.schedule({ notifications: toSchedule });
      }
      await refreshExactAlarmState();
      // Success-path signal too, so scheduled-RATE (not just failures) is
      // measurable — emitted even at count 0 (toggle off / nothing due).
      // `notif_exact_alarm` is the load-bearing field: a 'denied' fleet means
      // reminders are being delivered inexactly (Doze-batched) even though the
      // schedule itself looks perfectly healthy — the original #55 defect.
      logEvent({
        level: 'info',
        surface: 'local-notifications',
        message: 'reschedule',
        context: {
          notif_count: toSchedule.length,
          notif_lead_default: prefs.value.todoReminderLead,
          notif_truncated: truncated,
          notif_exact_alarm: exactAlarmState,
        },
      });
    } catch (e) {
      reportError({
        surface: 'local-notifications-schedule',
        severity: 'warning',
        message: 'reschedule failed; the in-app briefing still shows these items',
        error: e,
        context: { notif_count: toSchedule.length, notif_error_stage: 'schedule' },
      });
    }
  }

  // Debounced reschedule on any input/pref change (and once on mount). A burst of
  // reactive edits coalesces into a single cancel-all/reschedule.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  watch(
    [reminderInput, prefs],
    () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void reschedule(), RESCHEDULE_DEBOUNCE_MS);
    },
    { immediate: true, deep: true }
  );
}

/** Test-only — reset the singleton guard between cases. */
export function __resetLocalNotificationsForTesting(): void {
  initialized = false;
}
