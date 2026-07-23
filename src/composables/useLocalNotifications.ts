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
import { useToday } from '@/composables/useToday';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';
import {
  ensureNotificationPermission,
  refreshExactAlarmPermission,
  exactAlarmPermission,
  notificationPermission,
  __resetNotificationPermissionForTesting,
} from '@/composables/useNotificationPermission';

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
 * Strategy: RECONCILE (debounced) on any input/pref change — schedule the
 * desired set, then cancel only what is pending-but-no-longer-desired.
 * Deliberately not cancel-all-then-schedule: that destroys every working alarm
 * before creating the replacements, so one transient `schedule()` rejection
 * leaves the device with NO reminders at all. Scheduling an id that is already
 * pending replaces it (Android reuses the PendingIntent by request code —
 * FLAG_CANCEL_CURRENT with request code = notification id; iOS replaces by
 * identifier), so the reorder is free. Both failure directions now degrade
 * toward "too many reminders", never "none".
 *
 * The `@capacitor/local-notifications` import is confined to this module and
 * `useNotificationPermission`. No-op on web (the in-app briefing surfaces the
 * same items there). See ADR-029.
 */

const RESCHEDULE_DEBOUNCE_MS = 1000;
const REMINDERS_CHANNEL_ID = 'reminders';

/**
 * Map a stable string id to a positive 32-bit int — the plugin requires integer
 * notification ids, and the mapping must be stable so a reschedule re-uses the
 * same id for the same logical reminder (which is what makes "schedule replaces
 * pending" work). FNV-1a over the string.
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
 * Map the pure schedule to plugin payloads. `allowWhileIdle` permits firing
 * during Doze (exactness comes from the manifest — see the module docstring);
 * `channelId` targets the high-importance reminders channel (created at init);
 * `extra.kind` lets the delivered-listener tag its telemetry, and `extra.at`
 * carries the intended fire time so that listener can measure lateness.
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
    extra: { kind: r.kind, at: r.fireAt.getTime() },
  }));
}

/**
 * Bucket delivery lateness. Bucketed rather than raw ms to keep the telemetry
 * key low-cardinality and PII-free.
 */
export function latenessBucket(deliveredAt: number, intendedAt: number): string {
  const late = deliveredAt - intendedAt;
  if (late < 30_000) return 'on_time';
  if (late < 60_000) return 'lt_1m';
  if (late < 300_000) return 'lt_5m';
  if (late < 900_000) return 'lt_15m';
  return 'gte_15m';
}

// ── Module-scoped state ───────────────────────────────────────────────────────
// All of it lives here, NOT inside the composable, because
// `__resetLocalNotificationsForTesting()` is module-level and cannot reach
// function-local closures — leaving any of it inside would make the reset a
// silent no-op and give the suite order-dependence.
let initialized = false;
let channelReady = false;
let debounce: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let rerunQueued = false;
/** One schedule-failure toast per session — `reschedule()` runs on every
 *  debounced data change, and a persistently-failing device would otherwise
 *  toast red on every edit until the user learned to ignore it. */
let scheduleFailureToasted = false;

/**
 * Wire on-device reminders. Call ONCE from `App.vue` setup. Idempotent. No-op on
 * web (the in-app `FamilyStatusToast` briefing already surfaces these items there).
 */
/** Create the reminders channel (idempotent). On Android O+ a notification
 *  posted to a non-existent channel is silently dropped, so this MUST run
 *  before the first schedule. Returns false when the channel is unavailable. */
async function ensureChannel(): Promise<boolean> {
  if (channelReady) return true;
  try {
    await LocalNotifications.createChannel({
      id: REMINDERS_CHANNEL_ID,
      name: 'Reminders',
      importance: 4, // HIGH — heads-up + sound, so a time-critical reminder is seen
    });
    channelReady = true;
    return true;
  } catch (e) {
    // Critical on Android: without the channel EVERY reminder is silently
    // dropped by the OS, which is the same user impact as a failed schedule.
    reportError({
      surface: 'local-notifications-schedule',
      severity: getPlatform() === 'android' ? 'critical' : 'warning',
      message: 'createChannel(reminders) failed; reminders will not post on Android O+',
      error: e,
      context: { notif_error_stage: 'channel' },
    });
    return false;
  }
}

/**
 * Steps 2-4 of the reconcile: schedule the desired set, cancel what is stale,
 * emit the outcome. Split out and exported so the ordering and both failure
 * directions are unit-testable against a mocked plugin — with no Pinia, no Vue
 * watch and no fake timers.
 */
export async function reconcileScheduled(
  toSchedule: LocalNotificationSchema[],
  granted: boolean,
  meta: { truncated: boolean; skipped: number; todoLead: number }
): Promise<void> {
  const desiredIds = new Set(toSchedule.map((n) => n.id));

  // Step 2 — schedule. Guarded by its own try/catch: if this throws, the
  // previously-armed alarms are still intact and the user is no worse off.
  if (granted && toSchedule.length > 0) {
    try {
      await ensureChannel();
      await LocalNotifications.schedule({ notifications: toSchedule });
      scheduleFailureToasted = false; // recovered
    } catch (e) {
      reportError({
        surface: 'local-notifications-schedule',
        severity: 'critical',
        message: 'failed to arm device reminders',
        error: e,
        context: { notif_count: toSchedule.length, notif_error_stage: 'schedule' },
      });
      if (!scheduleFailureToasted) {
        scheduleFailureToasted = true;
        // `silent` because we just reported this ourselves at `critical` under a
        // precise surface — an error toast auto-reports on surface `app`, which
        // would double-log the same failure into two un-dedupable buckets.
        const t = useTranslationStore().t;
        showToast('error', t('reminders.scheduleFailed'), t('reminders.scheduleFailedHelp'), {
          silent: true,
        });
      }
      return;
    }
  }

  // Step 3 — cancel only what is no longer wanted. Runs REGARDLESS of
  // permission: cancelling needs none, and a denied or failed permission check
  // must never strand alarms on the device. If this throws the user has surplus
  // reminders, not missing ones, so it stays a warning.
  try {
    const pending = await LocalNotifications.getPending();
    const stale = pending.notifications
      .filter((n) => !desiredIds.has(n.id))
      .map((n) => ({ id: n.id }));
    if (stale.length > 0) await LocalNotifications.cancel({ notifications: stale });
  } catch (e) {
    reportError({
      surface: 'local-notifications-schedule',
      severity: 'warning',
      message: 'failed to cancel stale reminders; some may fire for removed items',
      error: e,
      context: { notif_error_stage: 'cancel' },
    });
  }

  await refreshExactAlarmPermission();

  // Step 4 — success-path signal too, so scheduled-RATE (not just failures) is
  // measurable; emitted even at count 0 (toggle off / nothing due).
  // `notif_exact_alarm` is the load-bearing field: a 'denied' fleet means
  // reminders are being delivered inexactly (Doze-batched) even though the
  // schedule itself looks perfectly healthy — the original #55 defect.
  logEvent({
    level: 'info',
    surface: 'local-notifications',
    message: 'reschedule',
    context: {
      notif_count: toSchedule.length,
      notif_lead_default: meta.todoLead,
      notif_truncated: meta.truncated,
      notif_skipped: meta.skipped,
      notif_exact_alarm: exactAlarmPermission.value,
      notif_permission: notificationPermission.value,
    },
  });
}

export function useLocalNotifications(): void {
  if (initialized) return;
  if (!isNative()) return;
  initialized = true;

  const { reminderInput, prefs } = useScheduledReminders();
  const { isVisible } = useToday();

  // Delivered (best-effort) — closes the scheduled-vs-delivered-vs-late triage
  // loop (the original #55 defect) from CloudWatch without a local repro.
  // NOTE: only fires while the app process is alive, so lateness is a biased
  // SAMPLE, not a census. Good enough to detect a fleet-wide inexact downgrade;
  // useless for auditing one delivery.
  LocalNotifications.addListener('localNotificationReceived', (n) => {
    const extra = n.extra as { kind?: string; at?: number } | undefined;
    const context: Record<string, string> = {};
    if (extra?.kind) context.notif_kind = extra.kind;
    if (Number.isFinite(extra?.at)) {
      context.notif_lateness_bucket = latenessBucket(Date.now(), extra!.at!);
    }
    logEvent({
      level: 'info',
      surface: 'local-notifications',
      message: 'notification delivered',
      context: Object.keys(context).length ? context : undefined,
    });
  }).catch((e) =>
    reportError({
      surface: 'local-notifications',
      severity: 'warning',
      message: 'delivered-listener registration failed; delivery telemetry is blind this session',
      error: e,
      context: { notif_error_stage: 'listener' },
    })
  );

  async function reschedule(): Promise<void> {
    // Fresh `now` each run — no fireAt drifts past between recompute and schedule.
    const { reminders, truncated, skipped } = buildReminderSchedule(
      reminderInput.value,
      new Date(),
      prefs.value
    );
    const toSchedule = buildScheduledNotifications(reminders);

    // Step 1 — always CHECK (so a mid-session revoke is visible); only PROMPT
    // when there is actually something to remind about.
    const granted = await ensureNotificationPermission(toSchedule.length > 0);

    await reconcileScheduled(toSchedule, granted, {
      truncated,
      skipped,
      todoLead: prefs.value.todoReminderLead,
    });
  }

  /**
   * The single entry point. Every trigger goes through here — never call
   * `reschedule()` directly: with schedule-then-cancel-stale, an overlapping run
   * can observe the other run's freshly-scheduled ids via `getPending()` and
   * cancel them as "stale".
   */
  async function runReschedule(): Promise<void> {
    if (inFlight) {
      rerunQueued = true;
      return;
    }
    inFlight = true;
    try {
      await reschedule();
    } finally {
      inFlight = false;
      if (rerunQueued) {
        rerunQueued = false;
        queueReschedule();
      }
    }
  }

  function queueReschedule(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void runReschedule(), RESCHEDULE_DEBOUNCE_MS);
  }

  // Debounced reschedule on any input/pref change (and once on mount).
  watch([reminderInput, prefs], queueReschedule, { immediate: true, deep: true });

  // Re-anchor on foreground. Alarms are absolute epochs, so crossing a timezone
  // leaves them pointing at the wrong wall-clock time — a return leg armed at
  // home would fire hours after the flight. Rescheduling on EVERY foreground
  // (not just on a tz change) also recovers from reboots, manual clock changes
  // and OEM alarm purges; the tz comparison only decides whether to log.
  // Reuses `useToday`'s wake sink — it owns the app's only visibilitychange
  // listener and every other consumer watches it rather than adding its own.
  let lastTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  watch(isVisible, (visible) => {
    if (!visible) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz !== lastTz) {
      lastTz = tz;
      logEvent({
        level: 'info',
        surface: 'local-notifications',
        message: 'timezone changed',
        context: { notif_tz_changed: true },
      });
    }
    queueReschedule();
  });
}

/** Test-only — reset ALL module state between cases. Every module-scoped
 *  mutable added above must be cleared here, or the suite gains order-dependence. */
export function __resetLocalNotificationsForTesting(): void {
  initialized = false;
  channelReady = false;
  if (debounce) clearTimeout(debounce);
  debounce = null;
  inFlight = false;
  rerunQueued = false;
  scheduleFailureToasted = false;
  __resetNotificationPermissionForTesting();
}
