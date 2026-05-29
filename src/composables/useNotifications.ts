/**
 * Side-effect wiring for in-app notifications — call ONCE in App.vue (mirrors
 * `useLocalNotifications`). Owns no business state; only drives store actions +
 * the OS app-badge effect:
 *   1. Poll → `store.tick()` so time-based items activate while open + on wake.
 *   2. PWA app-icon badge synced to `store.unreadCount` (the ONLY badge writer).
 *   3. One-time What's-New localStorage→synced read-state migration + prune.
 *   4. Auto-open the drawer to the latest unseen auto-open item (a spotlight
 *      release or an auto-open announcement) on login (store latch).
 *   5. Daily tip issuance — one bell entry per local day from `useBeanTips`.
 */
import { watch } from 'vue';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { useBeanTips } from '@/composables/useBeanTips';
import { useToday } from '@/composables/useToday';
import { isDocLoaded } from '@/services/automerge/docService';
import { getAllReleaseNotes } from '@/content/release-notes';
import { whatsNewId } from '@/utils/notifications';

const LAST_SEEN_WHATS_NEW_KEY = 'beanies-lastSeenWhatsNew';

/** Navigator with the (optional) Badging API surface, feature-detected at use. */
type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function useNotifications(): void {
  const store = useNotificationsStore();
  const authStore = useAuthStore();
  const settingsStore = useSettingsStore();
  const familyStore = useFamilyStore();
  const beanTips = useBeanTips();
  const { today } = useToday();

  // Shared session-ready gate — both the migration/auto-open watcher (#4) and
  // the daily-tip watcher (#5) consult it, so neither inlines the conjunction.
  const ready = (): boolean =>
    authStore.isAuthenticated &&
    settingsStore.onboardingCompleted &&
    Boolean(familyStore.currentMember);

  // 1. Advance the derive-clock so time-based notifications activate while open
  //    and immediately on tab wake. The poll catches + reports a throwing tick.
  usePollWhileVisible(() => store.tick(), 60_000, {
    fireImmediatelyOnVisible: true,
    surface: 'notifications-tick',
  });

  // 2. PWA / installed-app icon badge — the ONLY writer of the OS badge.
  //    Feature-detected + failure-tolerant (absence is expected on most browsers,
  //    so a failure is a single console.warn, never reportError spam).
  watch(
    () => store.unreadCount,
    (count) => {
      if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
      const nav = navigator as BadgingNavigator;
      try {
        if (count > 0) void nav.setAppBadge?.(count);
        else void nav.clearAppBadge?.();
      } catch (err) {
        console.warn('[useNotifications] app-icon badge update failed', err);
      }
    },
    { immediate: true }
  );

  // 3. One-time What's-New migration: seed synced read-state for every release
  //    version ≤ the legacy localStorage marker (string `<=`, date-based zero-
  //    padded versions — never parseFloat), so prior releases don't resurface as
  //    unread. Then prune stale read-state. Runs once, after a doc + member exist.
  let migrationDone = false;
  function runWhatsNewMigrationOnce(): void {
    if (migrationDone || !isDocLoaded() || !familyStore.currentMember) return;
    migrationDone = true;
    let lastSeen = '';
    try {
      lastSeen = localStorage.getItem(LAST_SEEN_WHATS_NEW_KEY) ?? '';
    } catch (err) {
      console.warn('[useNotifications] could not read lastSeenWhatsNew — skipping seed', err);
    }
    if (lastSeen) {
      for (const release of getAllReleaseNotes()) {
        if (release.version <= lastSeen) store.markRead(whatsNewId(release.version));
      }
    }
    store.pruneReads();
  }

  // 4. Gate: once signed-in + onboarded + a member is known, run the one-time
  //    migration and auto-open to the latest unseen release. Suppressed in E2E
  //    (the drawer would block test interactions; mirrors the old WhatsNew gate).
  //    Also issues today's tip alongside the migration — both are session-ready
  //    side-effects that need the same gate.
  watch(
    () => ready(),
    (isReady) => {
      if (!isReady) return;
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('e2e_auto_auth')) return;
      runWhatsNewMigrationOnce();
      store.openToLatestAutoOpen();
      beanTips.ensureTodayTipIssued();
    },
    { immediate: true }
  );

  // 5. Daily tip issuance — runs on every local-day roll while ready.
  //    `ensureTodayTipIssued()` no-ops when `lastTipShownDate === today`, so
  //    same-flush double-fires (session-ready + day-roll) are safely idempotent.
  //    NOT `immediate: true` — the first call comes from the session-ready
  //    watcher above; this watcher only handles day-roll while the tab is open.
  watch(today, () => {
    if (!ready()) return;
    beanTips.ensureTodayTipIssued();
  });
}
