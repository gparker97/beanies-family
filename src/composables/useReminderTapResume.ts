/**
 * Reminder-notification TAP → open the item (the deep-link half of #55).
 *
 * Tapping an OS local notification used to just resume the app to whatever
 * screen it was on. This module turns that tap into a router navigation to the
 * exact entity, reusing the SAME path the in-app bell "Open" uses:
 * `entityDeepLink(type,id)` → `router.push({path,query})` → the destination
 * page's `useDeepLinkParam` opens the modal once its store hydrates. No
 * per-page work is needed here.
 *
 * Why this lives OUTSIDE `useLocalNotifications`: that module is a
 * service-flavoured, native-only scheduler with no router dependency. It only
 * calls `handleReminderTap(extra)`; all routing lives here, so the scheduler
 * stays decoupled from navigation (and there is no import cycle — this module
 * never imports the scheduler).
 *
 * COLD START is the case this exists for. A tap on a killed app fires
 * `actionPerformed` at launch, long before the family doc is loaded, so we
 * cannot navigate immediately. The tap stashes an intent in a MODULE-scoped ref
 * and a reactive watch navigates once the app is ready. A module ref (not
 * sessionStorage) is correct here because a notification tap is an in-process
 * Capacitor event — unlike the OAuth redirect, the JS context is never torn
 * down — and because `{ immediate: true }` means the watch consumes any intent
 * stashed before it was created, so ordering can never lose the tap.
 */
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import { type DeepLink } from '@/utils/entityDeepLink';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

const SURFACE = 'local-notifications';

/**
 * The notification `extra` payload contract — written by
 * `buildScheduledNotifications`, read by the tap handler. Declared once here so
 * the writer and reader cannot drift. `kind` is a plain string (not the
 * reminder-kind union) because it is only ever a telemetry label.
 */
export interface ReminderExtra {
  kind?: string;
  at?: number;
  link?: DeepLink;
}

/** One definition of the tap event, so every outcome is shaped identically. */
function logTapOutcome(
  outcome: 'navigated' | 'deferred' | 'ignored-no-target',
  kind?: string
): void {
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'notification tapped',
    context: { ...(kind ? { notif_kind: kind } : {}), notif_tap_outcome: outcome },
  });
}

/** The pending tap, held until the app is ready to navigate. Module-scoped so it
 *  survives from the launch tap until `useReminderTapResume`'s watch runs. */
const pendingIntent = ref<{ link: DeepLink; kind?: string } | null>(null);

/**
 * The single entry point the notification tap listener calls. Stashes a
 * targetable tap, or logs+drops an untargetable one (a notification scheduled
 * by a build older than this change carries no `link` — benign, and it
 * self-heals as soon as the reminders reconcile re-schedules with one).
 */
export function handleReminderTap(extra: ReminderExtra | undefined): void {
  if (extra?.link) {
    pendingIntent.value = { link: extra.link, kind: extra.kind };
    return; // the watch below resolves this to 'navigated' or 'deferred'
  }
  logTapOutcome('ignored-no-target', extra?.kind);
}

/** TEST ONLY — clear the module-scoped intent between cases. */
export function __resetReminderTapForTesting(): void {
  pendingIntent.value = null;
}

/**
 * Call ONCE from App.vue (next to `useCalendarRedirectResume`). Navigates a
 * pending tap as soon as the app can actually show the item.
 */
export function useReminderTapResume(): void {
  const router = useRouter();
  const authStore = useAuthStore();

  // Reactive readiness. Reading `docVersion.value` is MANDATORY, not decorative:
  // `isDocLoaded()` reads a plain module-level boolean, so without an explicit
  // subscription to the `docVersion` trigger this computed would never
  // re-evaluate when the family doc finishes loading — the deferred cold-start
  // intent would then sit unnavigated forever (a silent failure of the whole
  // feature). `docVersion` bumps on load + every mutation.
  const ready = computed(() => {
    void docVersion.value;
    return authStore.podCreated && isDocLoaded();
  });

  let deferredLogged = false;

  function attempt(): void {
    const intent = pendingIntent.value;
    if (!intent) return;
    if (!ready.value) {
      // Log once — the watch re-fires on every readiness change and we don't
      // want a deferral storm in the firehose.
      if (!deferredLogged) {
        deferredLogged = true;
        logTapOutcome('deferred', intent.kind);
      }
      return;
    }
    // Consume BEFORE navigating: `router.push` is async, so clearing first means
    // a rejecting/broken link can never re-enter and loop.
    pendingIntent.value = null;
    deferredLogged = false;
    void router
      .push(intent.link)
      .then(() => logTapOutcome('navigated', intent.kind))
      .catch((e) =>
        // NOTE: must be `.catch`, not try/catch — push is a Promise, so a
        // navigation-guard rejection would otherwise escape as an unhandled
        // rejection. A "duplicated navigation" (already on the target) RESOLVES,
        // so tapping while the item is already open is not an error.
        reportError({
          surface: SURFACE,
          severity: 'warning',
          message: 'reminder tap navigation failed; the item did not open',
          error: e,
          context: { notif_error_stage: 'tap-navigate' },
        })
      );
  }

  watch([pendingIntent, ready], attempt, { immediate: true });
}
