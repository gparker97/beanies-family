import { watch } from 'vue';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { isNative } from '@/services/sync/capabilities';
import { useCriticalItems, type CriticalItem } from '@/composables/useCriticalItems';
import { useToday } from '@/composables/useToday';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';

/**
 * On-device local notifications for the native (Capacitor) app — ADR-029 A4.
 *
 * Schedules a reminder for each TIMED item in today's briefing
 * (`useCriticalItems`) at its time, so a family member gets pinged when a
 * pickup / dropoff / timed activity / due-today to-do is due. Reminders are
 * generated entirely ON-DEVICE from already-decrypted data — beanies' servers
 * never see the schedule (this is why it's local notifications, not remote
 * push: a zero-knowledge backend can't trigger meaningful per-user pushes).
 *
 * Strategy: cancel-all-then-reschedule (debounced) on any briefing change —
 * correct for a family's item volumes, with no diff-state to drift. The
 * `@capacitor/local-notifications` import is confined to this module. No-op on
 * web. See ADR-029.
 */

const RESCHEDULE_DEBOUNCE_MS = 1000;

/**
 * Map a `CriticalItem.id` (a UUID, or a synthesized `holiday-…`) to a stable,
 * positive 32-bit int — the plugin requires integer notification ids, and the
 * mapping must be stable so "cancel on completion" cancels the right reminder.
 * FNV-1a over the string.
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
 * Pure: build the notification payloads for today's timed, not-yet-completed
 * briefing items whose time is still in the future. Exported for unit testing.
 */
export function buildScheduledNotifications(
  items: CriticalItem[],
  todayStr: string,
  nowMs: number
): LocalNotificationSchema[] {
  const out: LocalNotificationSchema[] = [];
  for (const item of items) {
    if (!item.time || item.completed) continue; // untimed → no specific fire time; done → no reminder
    const at = new Date(`${todayStr}T${item.time}:00`);
    if (Number.isNaN(at.getTime()) || at.getTime() <= nowMs) continue; // invalid or already past
    out.push({
      id: stableNotificationId(item.id),
      title: 'beanies.family',
      body: item.message,
      schedule: { at },
    });
  }
  return out;
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

  const { criticalItems } = useCriticalItems();
  const { today } = useToday();

  let permissionGranted = false;
  let permissionRequested = false;

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
          message: `notifications permission: ${display}`,
        });
      }
      return permissionGranted;
    } catch (e) {
      reportError({
        surface: 'local-notifications-permission',
        severity: 'warning',
        message: 'notification permission check/request failed',
        error: e,
      });
      return false;
    }
  }

  async function reschedule(): Promise<void> {
    const toSchedule = buildScheduledNotifications(criticalItems.value, today.value, Date.now());

    // Don't surface the OS permission prompt until there's actually something to
    // remind about (and we haven't been granted yet). Once granted, we still run
    // to clear stale reminders (e.g. an item got completed) even if empty now.
    if (toSchedule.length === 0 && !permissionGranted) return;

    if (!(await ensurePermission())) return;

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
    } catch (e) {
      reportError({
        surface: 'local-notifications-schedule',
        severity: 'warning',
        message: 'reschedule failed; the in-app briefing still shows these items',
        error: e,
      });
    }
  }

  // Debounced reschedule on any briefing change (and once on mount). A burst of
  // reactive edits coalesces into a single cancel-all/reschedule.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  watch(
    criticalItems,
    () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void reschedule(), RESCHEDULE_DEBOUNCE_MS);
    },
    { immediate: true }
  );
}

/** Test-only — reset the singleton guard between cases. */
export function __resetLocalNotificationsForTesting(): void {
  initialized = false;
}
