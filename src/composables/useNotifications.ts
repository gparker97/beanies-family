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
import { useRouter } from 'vue-router';
import { isPodlessExpectedRoute } from '@/utils/appChrome';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { useBeanTips } from '@/composables/useBeanTips';
import { useCommunityNudge } from '@/composables/useCommunityNudge';
import { useInstallNudge } from '@/composables/useInstallNudge';
import { useFeedbackModal } from '@/composables/useFeedbackModal';
import { useToday } from '@/composables/useToday';
import { isDocLoaded } from '@/services/automerge/docService';
import { getAllReleaseNotes } from '@/content/release-notes';
import { whatsNewId } from '@/utils/notifications';
import { consumeFamilyJustCreated } from '@/utils/newFamilyFlag';

const LAST_SEEN_WHATS_NEW_KEY = 'beanies-lastSeenWhatsNew';

/** Navigator with the (optional) Badging API surface, feature-detected at use. */
type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function useNotifications(): void {
  const router = useRouter();
  const store = useNotificationsStore();
  const authStore = useAuthStore();
  const settingsStore = useSettingsStore();
  const familyStore = useFamilyStore();
  const beanTips = useBeanTips();
  const communityNudge = useCommunityNudge();
  const installNudge = useInstallNudge();
  const feedbackModal = useFeedbackModal();
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
      // Brand-new family (just created this session): seed ALL existing releases
      // as read so the what's-new drawer does NOT auto-open for a user who never
      // not-had those features (2026-06-19). MUST run before openToLatestAutoOpen
      // below. Consumed once; returning users (any of the 4 load paths) never set
      // the flag, so their genuine-update auto-open is unaffected.
      if (consumeFamilyJustCreated()) {
        for (const release of getAllReleaseNotes()) {
          store.markRead(whatsNewId(release.version));
        }
      }
      // Issue tip + nudge BEFORE auto-open so a freshly-due community nudge is in
      // the derived list when openToLatestAutoOpen() reads it (tips don't auto-open).
      beanTips.ensureTodayTipIssued();
      communityNudge.ensureNudgeIssued();
      installNudge.ensureNudgeIssued();
      // Never auto-open mid-onboarding. On the iOS create/resume flow the family
      // can be created on a podless route (e.g. resume-setup), and the ready()
      // watcher could fire before navigation to /nook — auto-opening the drawer
      // over the setup screen (the 2026-06-20 report). The seed-as-read above
      // still runs, so nothing pops once the user lands in /nook. Uses the SAME
      // predicate App.vue uses for podless routing (no duplicated route logic).
      if (!isPodlessExpectedRoute(router.currentRoute.value)) {
        store.openToLatestAutoOpen();
        // #45: lowest-priority auto-interruption — runs AFTER openToLatestAutoOpen so
        // the what's-new drawer claims the session's single slot first. Self-gated on
        // cadence + the shared claim; never throws (reports + swallows internally).
        // Deliberately NOT on the day-roll watcher below (no podless guard → would pop
        // mid-session); req is "on app load", satisfied by this session-ready seam.
        feedbackModal.maybeAutoPromptFeedback(settingsStore);
      }
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
    communityNudge.ensureNudgeIssued();
    installNudge.ensureNudgeIssued();
  });
}
