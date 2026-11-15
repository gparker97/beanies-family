/**
 * The one-time What's-New migration is an automatic writer (it marks releases read and prunes
 * read-state in the synced document), so it must never run against a projection snapshot
 * (plan 2026-11-15, requirement 3): the snapshot is last session's copy, and pruning or seeding
 * from it writes stale read-state back. It runs once the stores hold the AUTHORITATIVE document,
 * whichever comes last: the session becoming ready, or the stores turning authoritative.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';

const h = vi.hoisted(() => ({
  store: {
    markRead: vi.fn(),
    pruneReads: vi.fn(),
    tick: vi.fn(),
    openToLatestAutoOpen: vi.fn(),
    unreadCount: 0,
  },
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: { value: {} } }) }));
// A public entry route: no drawer auto-open, no feedback prompt (out of scope here).
vi.mock('@/utils/appChrome', () => ({ isPublicEntryRoute: () => true }));
vi.mock('@/stores/notificationsStore', () => ({ useNotificationsStore: () => h.store }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ isAuthenticated: true }) }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ onboardingCompleted: true }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'm1' } }),
}));
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: () => ({ stop: () => {} }),
}));
vi.mock('@/composables/useBeanTips', () => ({
  useBeanTips: () => ({ ensureTodayTipIssued: vi.fn() }),
}));
vi.mock('@/composables/useCommunityNudge', () => ({
  useCommunityNudge: () => ({ ensureNudgeIssued: vi.fn() }),
}));
vi.mock('@/composables/useInstallNudge', () => ({
  useInstallNudge: () => ({ ensureNudgeIssued: vi.fn() }),
}));
vi.mock('@/composables/useFeedbackModal', () => ({
  useFeedbackModal: () => ({ maybeAutoPromptFeedback: vi.fn() }),
}));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today: ref('2026-11-15') }) }));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
vi.mock('@/content/release-notes', () => ({
  getAllReleaseNotes: () => [{ version: '2026-01-01' }, { version: '2026-09-01' }],
}));
vi.mock('@/utils/newFamilyFlag', () => ({ consumeFamilyJustCreated: () => false }));

import { useNotifications } from '../useNotifications';
import {
  __resetLoadMaintenanceForTesting,
  __setStoresAuthoritativeForTesting,
} from '@/services/automerge/loadMaintenance';

let scope: EffectScope | null = null;
const mount = () => {
  scope = effectScope();
  scope.run(() => useNotifications());
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetLoadMaintenanceForTesting();
  localStorage.clear();
  localStorage.setItem('beanies-lastSeenWhatsNew', '2026-01-01');
});

afterEach(() => {
  scope?.stop();
  scope = null;
  __resetLoadMaintenanceForTesting();
});

describe("useNotifications: the What's-New migration waits for authoritative stores", () => {
  it('writes nothing while the stores hold a snapshot, then runs ONCE when they turn authoritative', async () => {
    mount(); // session ready, stores on a snapshot
    await nextTick();
    expect(h.store.markRead).not.toHaveBeenCalled();
    expect(h.store.pruneReads).not.toHaveBeenCalled();

    __setStoresAuthoritativeForTesting(true);
    await nextTick();
    expect(h.store.markRead).toHaveBeenCalledTimes(1); // only the release <= the legacy marker
    expect(h.store.pruneReads).toHaveBeenCalledTimes(1);

    // Once per session: a later flip (a sign-out and back) does not run it again.
    __setStoresAuthoritativeForTesting(false);
    await nextTick();
    __setStoresAuthoritativeForTesting(true);
    await nextTick();
    expect(h.store.pruneReads).toHaveBeenCalledTimes(1);
  });

  it('runs at once when the stores are already authoritative as the session becomes ready', async () => {
    __setStoresAuthoritativeForTesting(true);
    mount();
    await nextTick();
    expect(h.store.pruneReads).toHaveBeenCalledTimes(1);
  });
});
