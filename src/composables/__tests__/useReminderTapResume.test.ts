import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

// Hoisted so the vi.mock factories below can reference them.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  logEvent: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: mocks.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: mocks.reportError }));

// Mirrors the REAL module shape: `docVersion` is a reactive trigger, while
// `isDocLoaded()` is a plain function over a non-reactive boolean. The
// composable must subscribe to docVersion, or a doc load never re-fires its
// watch — the cold-start bug these tests guard.
vi.mock('@/services/automerge/docService', async () => {
  const { shallowRef } = await import('vue');
  const docVersion = shallowRef(0);
  const state = { loaded: false };
  return { docVersion, isDocLoaded: () => state.loaded, __state: state };
});

vi.mock('@/stores/authStore', async () => {
  const { ref } = await import('vue');
  const podCreated = ref(false);
  return {
    useAuthStore: () => ({
      get podCreated() {
        return podCreated.value;
      },
    }),
    __podCreated: podCreated,
  };
});

import * as docService from '@/services/automerge/docService';
import * as authStoreModule from '@/stores/authStore';
import {
  handleReminderTap,
  useReminderTapResume,
  __resetReminderTapForTesting,
} from '../useReminderTapResume';

const docVersion = (docService as unknown as { docVersion: { value: number } }).docVersion;
const docState = (docService as unknown as { __state: { loaded: boolean } }).__state;
const podCreated = (authStoreModule as unknown as { __podCreated: { value: boolean } })
  .__podCreated;

const LINK = { path: '/todo', query: { view: 't-1' } };

function outcomes(): string[] {
  return mocks.logEvent.mock.calls
    .map((c) => (c[0] as { context?: { notif_tap_outcome?: string } }).context?.notif_tap_outcome)
    .filter(Boolean) as string[];
}

describe('useReminderTapResume', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.push.mockResolvedValue(undefined);
    __resetReminderTapForTesting();
    podCreated.value = false;
    docState.loaded = false;
    docVersion.value = 0;
  });

  it('navigates immediately when the app is already ready (warm tap)', async () => {
    podCreated.value = true;
    docState.loaded = true;
    useReminderTapResume();

    handleReminderTap({ kind: 'todo', link: LINK });
    await nextTick();

    expect(mocks.push).toHaveBeenCalledWith(LINK);
    await Promise.resolve();
    expect(outcomes()).toContain('navigated');
  });

  it('COLD START: defers while not ready, then navigates when the family doc loads', async () => {
    podCreated.value = true; // signed in, but the doc has not loaded yet
    useReminderTapResume();

    handleReminderTap({ kind: 'activity', link: LINK });
    await nextTick();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(outcomes()).toContain('deferred');

    // The doc finishes loading: isDocLoaded() flips AND docVersion bumps. The
    // bump alone must re-fire the watch — without the docVersion subscription
    // this would never navigate.
    docState.loaded = true;
    docVersion.value += 1;
    await nextTick();

    expect(mocks.push).toHaveBeenCalledWith(LINK);
  });

  it('does not navigate while the pod is not created, even once the doc is loaded', async () => {
    docState.loaded = true;
    useReminderTapResume();

    handleReminderTap({ kind: 'todo', link: LINK });
    await nextTick();
    expect(mocks.push).not.toHaveBeenCalled();

    podCreated.value = true;
    await nextTick();
    expect(mocks.push).toHaveBeenCalledWith(LINK);
  });

  it('ignores a tap with no target (a notification from an older build)', async () => {
    podCreated.value = true;
    docState.loaded = true;
    useReminderTapResume();

    handleReminderTap({ kind: 'todo' }); // no `link`
    await nextTick();

    expect(mocks.push).not.toHaveBeenCalled();
    expect(outcomes()).toContain('ignored-no-target');
  });

  it('reports a rejected navigation and does not loop (intent consumed first)', async () => {
    podCreated.value = true;
    docState.loaded = true;
    mocks.push.mockRejectedValue(new Error('guard rejected'));
    useReminderTapResume();

    handleReminderTap({ kind: 'travel', link: LINK });
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ context: { notif_error_stage: 'tap-navigate' } })
    );

    // The intent was consumed BEFORE the push, so a further readiness change
    // must not re-attempt the broken link.
    mocks.push.mockClear();
    docVersion.value += 1;
    await nextTick();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('navigates only once per tap', async () => {
    podCreated.value = true;
    docState.loaded = true;
    useReminderTapResume();

    handleReminderTap({ kind: 'todo', link: LINK });
    await nextTick();
    docVersion.value += 1; // an unrelated doc mutation
    await nextTick();

    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
});
