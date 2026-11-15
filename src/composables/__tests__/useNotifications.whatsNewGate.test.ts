/**
 * The What's New auto-open never runs before the legacy read-state migration (2026-11-15).
 *
 * On a projection-snapshot open the member is known long before the authoritative rebuild,
 * and the migration waits for `storesAuthoritative` (it must not seed or prune snapshot
 * read-state). The auto-open used to run on the member alone, so on a device whose only record
 * of a dismissed release is the legacy `lastSeenWhatsNew` marker, the drawer reopened a release
 * already seen. Both now wait on one gate, migration first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effectScope, nextTick, type Ref } from 'vue';

const h = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    notifications: {
      unreadCount: 0,
      tick: vi.fn(),
      markRead: vi.fn((id: string) => calls.push(`read:${id}`)),
      pruneReads: vi.fn(),
      openToLatestAutoOpen: vi.fn(() => calls.push('auto-open')),
    },
  };
});

vi.mock('@/services/automerge/loadMaintenance', async () => {
  const { ref } = await import('vue');
  return { storesAuthoritative: ref(false) };
});
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute: { value: { path: '/nook' } } }),
}));
vi.mock('@/utils/appChrome', () => ({ isPublicEntryRoute: () => false }));
vi.mock('@/utils/newFamilyFlag', () => ({ consumeFamilyJustCreated: () => false }));
vi.mock('@/content/release-notes', () => ({
  getAllReleaseNotes: () => [{ version: '2026.10.01' }, { version: '2026.11.10' }],
}));
vi.mock('@/stores/notificationsStore', () => ({ useNotificationsStore: () => h.notifications }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ isAuthenticated: true }) }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ onboardingCompleted: true }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'm1' } }),
}));
vi.mock('@/composables/usePollWhileVisible', () => ({ usePollWhileVisible: vi.fn() }));
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
vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  return { useToday: () => ({ today: ref('2026-11-15') }) };
});

import { storesAuthoritative } from '@/services/automerge/loadMaintenance';
import { useNotifications } from '../useNotifications';

/** The mocked flag is a plain ref, so the test can raise and lower it. */
const authoritative = storesAuthoritative as unknown as Ref<boolean>;
const notifications = h.notifications;

describe("useNotifications: What's New waits for the authoritative stores", () => {
  beforeEach(() => {
    h.calls.length = 0;
    vi.clearAllMocks();
    authoritative.value = false;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('seeds the legacy marker before any auto-open, and opens nothing while the stores hold a snapshot', async () => {
    localStorage.setItem('beanies-lastSeenWhatsNew', '2026.11.10'); // every release was seen
    const scope = effectScope();
    scope.run(() => useNotifications());
    await nextTick();

    // The session is ready (a member is known from the snapshot), the stores are not yet
    // authoritative: neither the migration nor the auto-open has run.
    expect(notifications.openToLatestAutoOpen).not.toHaveBeenCalled();
    expect(notifications.markRead).not.toHaveBeenCalled();

    authoritative.value = true;
    await nextTick();

    expect(h.calls).toEqual([
      'read:whats-new:2026.10.01',
      'read:whats-new:2026.11.10',
      'auto-open',
    ]);
    scope.stop();
  });

  it('a new release still auto-opens once the stores are authoritative; a later flip re-seeds nothing', async () => {
    localStorage.setItem('beanies-lastSeenWhatsNew', '2026.10.01'); // 2026.11.10 is new
    const scope = effectScope();
    scope.run(() => useNotifications());
    authoritative.value = true;
    await nextTick();
    expect(h.calls).toEqual(['read:whats-new:2026.10.01', 'auto-open']);

    // A family switch clears and re-raises the flag: the one-time migration does not repeat.
    authoritative.value = false;
    await nextTick();
    authoritative.value = true;
    await nextTick();
    expect(notifications.markRead).toHaveBeenCalledTimes(1);
    scope.stop();
  });
});
