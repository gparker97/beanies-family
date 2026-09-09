/**
 * Replacing a toast with a banner must not REDUCE the set of places a condition
 * reaches anyone. `BackgroundSyncBar` is mounted outside `v-if="showLayout"`, so
 * its toast is currently the only surface a blocker has on Login, LoadPod, Join,
 * CreatePod, OpenFromDrive, ShareTarget and SharedRecipe.
 *
 * So the suppression is narrow on purpose, and these tests pin both edges of it:
 * `decrypt` (which gained an out-of-layout banner) goes quiet, and everything
 * else — including a `decrypt` kind that never LATCHED — keeps its toast.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import BackgroundSyncBar from '@/components/common/BackgroundSyncBar.vue';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: toastMock }));

interface FakeSyncStore {
  isBackgroundSyncing: boolean;
  backgroundSyncError: string | null;
  backgroundSyncErrorKind: string | null;
  podUnopenable: boolean;
}

// ⚠️ `reactive`, not a plain object. The component under test watches
// `backgroundSyncError`, so a plain holder mutates silently and every assertion
// below would pass or fail for the wrong reason.
const holder = vi.hoisted(() => ({ store: null as unknown as FakeSyncStore }));
vi.mock('@/stores/syncStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/syncStore')>();
  const { reactive } = await import('vue');
  holder.store = reactive<FakeSyncStore>({
    isBackgroundSyncing: false,
    backgroundSyncError: null,
    backgroundSyncErrorKind: null,
    podUnopenable: false,
  });
  return { ...actual, useSyncStore: () => holder.store };
});

/** Mount, then raise a failure, so the watcher fires on a real transition. */
async function raise(opts: { kind: string | null; latched: boolean }) {
  holder.store.backgroundSyncError = null;
  holder.store.backgroundSyncErrorKind = null;
  holder.store.podUnopenable = false;
  const wrapper = mount(BackgroundSyncBar);
  holder.store.backgroundSyncErrorKind = opts.kind;
  holder.store.podUnopenable = opts.latched;
  holder.store.backgroundSyncError = 'boom';
  await nextTick();
  return wrapper;
}

describe('BackgroundSyncBar — the toast defers only where a banner exists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays QUIET for a latched decrypt block — PodUnreadableBanner has it', async () => {
    await raise({ kind: 'decrypt', latched: true });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('STILL toasts a decrypt kind that never latched', async () => {
    // ⚠️ THE `kind &&` GUARD'S REAL PURPOSE. Two paths set
    // `backgroundSyncErrorKind = 'decrypt'` WITHOUT `podUnopenable` — "password
    // may have changed" and a rotated family key — and `notePodUnopenable`
    // declines to latch that class. The banner's gate is
    // `podUnopenable && kind === 'decrypt'`, so neither gets one. Suppressing on
    // the kind alone would leave both silent.
    await raise({ kind: 'decrypt', latched: false });
    expect(toastMock).toHaveBeenCalledWith('warning', 'sync.backgroundError', undefined);
  });

  it('STILL toasts a lineage latch — its banner cannot render on a noChrome route', async () => {
    await raise({ kind: 'lineage', latched: true });
    expect(toastMock).toHaveBeenCalledWith('warning', 'sync.podUnopenable', 'boom');
  });

  it('STILL toasts a local-unreadable latch, for the same reason', async () => {
    await raise({ kind: 'local-unreadable', latched: true });
    expect(toastMock).toHaveBeenCalledWith('warning', 'sync.podUnopenable', 'boom');
  });

  it('STILL toasts an ordinary failure with no kind at all', async () => {
    await raise({ kind: null, latched: false });
    expect(toastMock).toHaveBeenCalledWith('warning', 'sync.backgroundError', undefined);
  });

  it('stays quiet for auth-transient, exactly as before', async () => {
    await raise({ kind: 'auth-transient', latched: false });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('SPEAKS AGAIN once the user has dismissed the banner', async () => {
    // ⚠️ THE HOLE. Suppressing on "this kind has a banner" is not the same as
    // "a banner is up". Dismiss hid the banner while this kept the toast
    // suppressed, so a session-ending blocker had no surface at all — and
    // nothing on the failed-retry path calls `clearPodUnopenable` to re-arm it.
    const { __resetBlockerDismissalsForTesting } = await import('@/composables/useBlockerLatch');
    __resetBlockerDismissalsForTesting();

    await raise({ kind: 'decrypt', latched: true });
    expect(toastMock).not.toHaveBeenCalled();

    // The user dismisses the banner; the latch is untouched.
    const { useBlockerLatch } = await import('@/composables/useBlockerLatch');
    const { dismissed } = useBlockerLatch('decrypt');
    dismissed.value = true;
    await nextTick();

    toastMock.mockClear();
    holder.store.backgroundSyncError = null;
    await nextTick();
    holder.store.backgroundSyncError = 'boom again';
    await nextTick();

    expect(toastMock).toHaveBeenCalledWith('warning', 'sync.podUnopenable', 'boom again');
  });
});
