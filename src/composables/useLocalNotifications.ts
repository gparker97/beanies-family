import { watch } from 'vue';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { isNative, getPlatform } from '@/services/sync/capabilities';
import {
  useScheduledReminders,
  buildReminderSchedule,
  type ScheduledReminder,
  type ReminderInput,
  type ReminderPrefs,
} from '@/composables/useScheduledReminders';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { handleReminderTap, type ReminderExtra } from '@/composables/useReminderTapResume';
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
 *
 * Entry points, outermost first:
 *   watch(reminderInput, prefs) → queueReschedule (debounce)
 *     → runReschedule (in-flight/rerun guard — never call reschedule directly)
 *       → runRescheduleFor(input, prefs, now)   ← EXPORTED SEAM. Holds the
 *         not-ready guard: `input === null` means the family doc isn't loaded,
 *         which is NOT "nothing to schedule". Reconciling against an empty
 *         desired set cancels every armed alarm on the device. DO NOT REMOVE —
 *         sign-out's cancel is `cancelAllScheduledReminders`, called explicitly
 *         from authStore, not a side effect of an empty schedule.
 *         → reconcileScheduled(...)             ← EXPORTED SEAM: schedule,
 *           cancel-stale, refresh exact-alarm, emit `reschedule`.
 */

const RESCHEDULE_DEBOUNCE_MS = 1000;
const REMINDERS_CHANNEL_ID = 'reminders_v2';
/**
 * The pre-fix channel id. A channel's importance/sound/vibration are FROZEN at
 * first creation — every later `createChannel` with the same id is a no-op — so
 * the vibration fix cannot reach a device that already created the original,
 * vibration-less `reminders` channel. The fix therefore publishes under a NEW id
 * (above) and retires this one on init. Do not reuse this string.
 */
const LEGACY_REMINDERS_CHANNEL_ID = 'reminders';

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
    // `link` carries the tap target VERBATIM (the same `{path,query}` the router
    // takes) — the delivered notification id is a lossy hash, so the target has
    // to ride in the payload. Typed by the shared `ReminderExtra` contract.
    extra: { kind: r.kind, at: r.fireAt.getTime(), link: r.deepLink } satisfies ReminderExtra,
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
  // Channels are an Android-O+ concept. `createChannel` is `call.unimplemented()`
  // on iOS (LocalNotificationsPlugin.swift:640) and throws on web, so without this
  // guard it rejected on EVERY iOS reschedule and emitted a warning each time —
  // noise that also buried a real Android channel failure in the same bucket.
  // Deliberately does NOT latch `channelReady`: that is module state cleared only
  // by the test reset, so latching it off a PLATFORM check would let a suite that
  // switches platform mid-run skip createChannel and report a false green on the
  // one guard protecting Android from silently dropping every reminder.
  if (getPlatform() !== 'android') return true;
  if (channelReady) return true;
  try {
    await LocalNotifications.createChannel({
      id: REMINDERS_CHANNEL_ID,
      name: 'Reminders',
      importance: 4, // HIGH — heads-up + sound, so a time-critical reminder is seen
      // MUST be set: Capacitor defaults `vibration` to false and calls
      // enableVibration(false) EXPLICITLY (NotificationChannelManager.java), so an
      // omitted flag means the reminder posts with no buzz on every device — not
      // "Android's default", an actively-disabled one.
      vibration: true,
      // `sound` is deliberately UNSET. Any value routes the plugin to
      // android.resource://…/raw/<name>, and there is no bundled raw sound, so
      // passing one would MUTE the channel. Unset = the OS default notification
      // sound, which a HIGH-importance channel already gets from its constructor.
    });
    channelReady = true;
    // Retire the pre-fix channel once per session. Its sound/vibration are frozen
    // (see LEGACY_REMINDERS_CHANNEL_ID), so a device that has it would keep the
    // silent one forever unless it is deleted and reminders move to the new id.
    // Best-effort: deleteChannel is a no-op for an absent id (fresh installs), so
    // a throw here must not fail the arm — the new channel is already created.
    try {
      await LocalNotifications.deleteChannel({ id: LEGACY_REMINDERS_CHANNEL_ID });
    } catch (e) {
      logEvent({
        level: 'debug',
        surface: 'local-notifications',
        message: 'legacy reminders channel cleanup skipped',
        context: { notif_error_stage: 'channel' },
        error: e,
      });
    }
    return true;
  } catch (e) {
    // Only reachable on Android now (the guard above returns early elsewhere),
    // so always critical: without the channel EVERY reminder is silently dropped
    // by the OS — the same user impact as a failed schedule.
    reportError({
      surface: 'local-notifications-schedule',
      severity: 'critical',
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
export interface ReconcileMeta {
  /** The MAX_SCHEDULED cap clipped the desired list. */
  truncated: boolean;
  /** Records dropped by a THROWN error — a malformed record. Actionable: data bug. */
  skipped: number;
  /** Records dropped by a RULE — None, hidden audience, non-traveller, anchorless
   *  duty. Expected, NOT a bug. Separate from `skipped` on purpose: conflating
   *  "we chose to drop this" with "this record is broken" makes both useless. */
  gated: number;
  /** Device to-do lead (minutes). */
  todoLead: number;
  /** Device DEFAULT activity lead. Decides whether activity reminders exist at
   *  all (0 = None), so "my activity reminders stopped" is untriageable without it. */
  activityLead: number;
}

export async function reconcileScheduled(
  toSchedule: LocalNotificationSchema[],
  granted: boolean,
  meta: ReconcileMeta
): Promise<void> {
  const desiredIds = new Set(toSchedule.map((n) => n.id));
  // What was ACTUALLY armed — not the size of the desired set. A denied or
  // channel-less device must report 0, or every fleet aggregate counts phantom
  // reminders for the whole denied population.
  let armed = 0;

  // Step 2 — schedule. Guarded by its own try/catch: if this throws, the
  // previously-armed alarms are still intact and the user is no worse off.
  if (granted && toSchedule.length > 0) {
    // Inside the `if`, not hoisted above it: ensureChannel never throws (it
    // catches and reports internally) and does NOT latch `channelReady` on
    // failure, so calling it on runs with nothing to schedule would emit a fresh
    // `critical` on every debounced reschedule for a broken-channel device.
    const channelOk = await ensureChannel();
    if (channelOk) {
      try {
        await LocalNotifications.schedule({ notifications: toSchedule });
        armed = toSchedule.length;
        scheduleFailureToasted = false; // recovered
      } catch (e) {
        reportError({
          surface: 'local-notifications-schedule',
          severity: 'critical',
          message: 'failed to arm device reminders',
          error: e,
          // NOTE: on THIS event `notif_count` is the count ATTEMPTED, not armed.
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
        // NO early return: step 3 must still run. "Stale" is `pending − desired`,
        // so alarms for items still wanted are never cancelled — only genuinely
        // removed ones are. Cancelling after a failed schedule therefore removes
        // exactly what should go and keeps what should stay. Returning here would
        // make the surplus permanent instead of transient.
      }
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
      // ARMED, not desired. See the `armed` declaration above.
      notif_count: armed,
      notif_lead_default: meta.todoLead,
      notif_activity_lead: meta.activityLead,
      notif_truncated: meta.truncated,
      notif_skipped: meta.skipped,
      notif_gated: meta.gated,
      notif_exact_alarm: exactAlarmPermission.value,
      notif_permission: notificationPermission.value,
    },
  });
}

/**
 * Cancel EVERY pending reminder. The explicit replacement for the cancel that
 * the not-ready guard in `runRescheduleFor` removes.
 *
 * Sign-out is the one case where "no family data" must mean "cancel", not
 * "wait". Until now that cancel happened by accident — signing out nulled
 * `currentMember`, which emptied the desired set, which made the reconcile
 * cancel the world. With the guard in place that path is gone, and pending
 * alarms carry activity titles and resolved member names: leaving them armed
 * would put family content on the lock screen of a device the user just signed
 * out of and wiped.
 */
export async function cancelAllScheduledReminders(): Promise<void> {
  if (!isNative()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }
  } catch (e) {
    reportError({
      surface: 'local-notifications-schedule',
      severity: 'warning',
      message:
        'failed to cancel reminders on sign-out; family content may remain on the lock screen',
      error: e,
      context: { notif_error_stage: 'cancel_all' },
    });
  }
}

/**
 * Steps 0-4 of one reschedule. Exported so the not-ready guard — the regression
 * that silently deleted every armed reminder on cold start — is testable with a
 * plain `ReminderInput` fixture, no Pinia and no Vue watch.
 */
export async function runRescheduleFor(
  input: ReminderInput | null,
  prefs: ReminderPrefs,
  now: Date
): Promise<void> {
  // "Not ready" is NOT "nothing to schedule". Until the family doc is loaded and
  // a current member exists, `reminderInput` is null and the desired set is
  // empty — reconciling against it would cancel every armed reminder on the
  // device. That happens on every cold start (lock screen, or killed before
  // decryption completes). Returns BEFORE the permission check too: prompting a
  // locked-out user is wrong. Deliberately emits nothing — a `notif_count: 0`
  // here is the exact misleading signal that made this bug invisible.
  // Sign-out's cancel is handled explicitly by `cancelAllScheduledReminders`.
  if (input === null) return;

  const { reminders, truncated, skipped, gated } = buildReminderSchedule(input, now, prefs);
  const toSchedule = buildScheduledNotifications(reminders);
  const granted = await ensureNotificationPermission(toSchedule.length > 0);
  await reconcileScheduled(toSchedule, granted, {
    truncated,
    skipped,
    gated,
    todoLead: prefs.todoReminderLead,
    activityLead: prefs.activityReminderLead,
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
    const extra = n.extra as ReminderExtra | undefined;
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

  // TAP → open the item. This module stays router-free: it just forwards the
  // payload, and `useReminderTapResume` (App.vue) owns the navigate-when-ready
  // logic — including the cold-start case, where the tap arrives long before the
  // family doc has loaded. All outcome decisions + logging live in the handler.
  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    handleReminderTap(action.notification?.extra as ReminderExtra | undefined);
  }).catch((e) =>
    reportError({
      surface: 'local-notifications',
      severity: 'warning',
      message:
        'tap-listener registration failed; notification taps will not deep-link this session',
      error: e,
      context: { notif_error_stage: 'tap-listener' },
    })
  );

  // Fresh `now` each run — no fireAt drifts past between recompute and schedule.
  const reschedule = (): Promise<void> =>
    runRescheduleFor(reminderInput.value, prefs.value, new Date());

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
