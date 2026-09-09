/**
 * A latch that stops sync for the whole session has to be VISIBLE, and for the
 * seven `decrypt` blockers it was not: the only surface was a four-second toast
 * from `BackgroundSyncBar`, whose own comment admitted as much.
 *
 * These tests pin the three things that made the previous fixes of this shape go
 * wrong: that the banner renders for EVERY kind that maps to `decrypt` (not just
 * the memory case that prompted it), that its retry actually reaches the store,
 * and that a version block re-latching is a persisting banner rather than a
 * silently vanishing one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import PodUnreadableBanner from '@/components/common/PodUnreadableBanner.vue';
import { BLOCKER_BANNER_KIND, BANNERED_BLOCKER_KINDS } from '@/stores/syncStore';
import {
  isBlockerDismissed,
  __resetBlockerDismissalsForTesting,
} from '@/composables/useBlockerLatch';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: toastMock }));

interface FakeSyncStore {
  podUnopenable: boolean;
  backgroundSyncErrorKind: string | null;
  podBlockMessageKey: string | null;
  backgroundSyncFromFile: ReturnType<typeof vi.fn>;
}

// ⚠️ `reactive`, NOT a plain object, and this is not a detail. `useBlockerLatch`
// is built on a `computed` and two `watch`es; against a plain holder none of them
// ever re-evaluates, so the dismissal re-arm had ZERO coverage — which is exactly
// how a bug shipped where dismissing the banner left the blocker with no surface
// at all. The sibling `backgroundSyncBarToast.test.ts` learned this first.
const holder = vi.hoisted(() => ({ store: null as unknown as FakeSyncStore }));
vi.mock('@/stores/syncStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/syncStore')>();
  const { reactive } = await import('vue');
  holder.store = reactive<FakeSyncStore>({
    podUnopenable: false,
    backgroundSyncErrorKind: null,
    podBlockMessageKey: null,
    backgroundSyncFromFile: vi.fn(async () => 'refreshed'),
  });
  return { ...actual, useSyncStore: () => holder.store };
});

function mountBanner() {
  return mount(PodUnreadableBanner, {
    global: {
      stubs: {
        ErrorBanner: {
          props: ['show', 'severity'],
          template:
            '<div v-if="show"><slot name="title" /><slot name="message" /><slot name="actions" /></div>',
        },
      },
    },
  });
}

function block(messageKey: string) {
  holder.store.podUnopenable = true;
  holder.store.backgroundSyncErrorKind = 'decrypt';
  holder.store.podBlockMessageKey = messageKey;
}

describe('PodUnreadableBanner — render', () => {
  beforeEach(() => {
    holder.store.podUnopenable = false;
    holder.store.backgroundSyncErrorKind = null;
    holder.store.podBlockMessageKey = null;
    holder.store.backgroundSyncFromFile = vi.fn(async () => 'refreshed');
    __resetBlockerDismissalsForTesting();
    vi.clearAllMocks();
  });

  it('renders for EVERY blocker key that maps to decrypt, not just the memory one', () => {
    // The memory latch is not a special case. A memory-only banner would have
    // left the other six speaking through a 4s toast — which is the bug.
    const decryptKeys = Object.entries(BLOCKER_BANNER_KIND)
      .filter(([, kind]) => kind === 'decrypt')
      .map(([key]) => key);

    expect(decryptKeys.length).toBe(7);
    for (const key of decryptKeys) {
      block(key);
      const text = mountBanner().text();
      expect(text).toContain('sync.podUnopenable');
      // The store's own key for this condition — honest per-kind copy, no ternary.
      expect(text).toContain(key);
    }
  });

  it('stays silent for a lineage block, so it cannot steal that banner', () => {
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'lineage';
    expect(mountBanner().text()).toBe('');
  });

  it('stays silent for a local-unreadable block', () => {
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'local-unreadable';
    expect(mountBanner().text()).toBe('');
  });

  it('stays silent when the kind is decrypt but nothing LATCHED', () => {
    // "password may have changed" and a rotated key both set the kind without
    // `podUnopenable`; `notePodUnopenable` declines to latch that class.
    holder.store.podUnopenable = false;
    holder.store.backgroundSyncErrorKind = 'decrypt';
    holder.store.podBlockMessageKey = 'podTooLarge.inline';
    expect(mountBanner().text()).toBe('');
  });
});

describe('PodUnreadableBanner — the retry', () => {
  beforeEach(() => {
    holder.store.backgroundSyncFromFile = vi.fn(async () => 'refreshed');
    __resetBlockerDismissalsForTesting();
    vi.clearAllMocks();
  });

  it('reaches the store as a MANUAL sync — the half-open retry', async () => {
    // `{ manual: true }` is what calls `syncService.retryAfterRemoteBlock()`.
    // Without it the banner's one button is decoration.
    block('podTooLarge.inline');
    const wrapper = mountBanner();

    await wrapper.findAll('button')[0]!.trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(holder.store.backgroundSyncFromFile).toHaveBeenCalledWith(undefined, { manual: true });
    expect(toastMock).toHaveBeenCalledWith('success', 'header.refreshSuccess');
  });

  it('a VERSION block re-latches with the same message rather than vanishing', async () => {
    // No number of retries lets this build parse a pod version it cannot read.
    // The accepted behaviour is an honest re-latch — what must never happen is
    // the banner quietly disappearing and leaving the user with nothing.
    block('podNewerVersion.inline');
    holder.store.backgroundSyncFromFile = vi.fn(async () => 'skipped-unopenable');
    const wrapper = mountBanner();

    await wrapper.findAll('button')[0]!.trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(toastMock).toHaveBeenCalledWith('warning', 'header.refreshUnopenable');
    expect(wrapper.text()).toContain('podNewerVersion.inline');
  });

  it('says something when the retry throws, instead of looking like it worked', async () => {
    block('podTooLarge.inline');
    holder.store.backgroundSyncFromFile = vi.fn(async () => {
      throw new Error('offline');
    });
    const wrapper = mountBanner();

    await wrapper.findAll('button')[0]!.trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(toastMock).toHaveBeenCalledWith('warning', 'sync.backgroundError');
  });

  it('a second tap during an in-flight retry does nothing', async () => {
    // Claim-before-await: a flag set after the await leaves the whole in-flight
    // window unguarded.
    block('podTooLarge.inline');
    let release: () => void = () => {};
    holder.store.backgroundSyncFromFile = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve('refreshed');
        })
    );
    const wrapper = mountBanner();

    await wrapper.findAll('button')[0]!.trigger('click');
    await wrapper.findAll('button')[0]!.trigger('click');
    release();
    await new Promise((r) => setTimeout(r, 0));

    expect(holder.store.backgroundSyncFromFile).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed', async () => {
    block('podTooLarge.inline');
    const wrapper = mountBanner();

    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.text()).toBe('');
  });

  it('a dismissal is VISIBLE to the toast layer, so the block keeps a surface', async () => {
    // ⚠️ THE HOLE THIS CLOSES. `BackgroundSyncBar` suppresses its toast for kinds
    // that have a banner. `dismissed` used to be component-local, so the bar
    // could not see it, and one tap on Dismiss left a session-ending blocker with
    // NO surface at all — banner hidden, toast suppressed — for the rest of the
    // session. Nothing on the failed-retry path calls `clearPodUnopenable`, so
    // the latch never re-arms by itself.
    block('podTooLarge.inline');
    expect(isBlockerDismissed('decrypt')).toBe(false);

    const wrapper = mountBanner();
    await wrapper.findAll('button')[1]!.trigger('click');

    expect(isBlockerDismissed('decrypt')).toBe(true);
  });

  it('a NEW block after a dismissal speaks again', async () => {
    block('podTooLarge.inline');
    const wrapper = mountBanner();
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.text()).toBe('');

    // The latch clears (a recovery), then a fresh failure arrives.
    holder.store.podUnopenable = false;
    await nextTick();
    expect(isBlockerDismissed('decrypt')).toBe(false);

    holder.store.podUnopenable = true;
    await nextTick();
    expect(wrapper.text()).toContain('sync.podUnopenable');
  });
});

describe('BANNERED_BLOCKER_KINDS — which kinds may lose their toast', () => {
  it('holds decrypt, the one kind whose banner renders outside the layout', () => {
    expect(BANNERED_BLOCKER_KINDS.has('decrypt')).toBe(true);
  });

  it('EXCLUDES lineage and local-unreadable, whose banners are in-layout only', () => {
    // Their banners cannot render on a `noChrome` route, so suppressing their
    // toast would take away the only surface they have on Login, LoadPod, Join,
    // CreatePod, OpenFromDrive, ShareTarget and SharedRecipe.
    expect(BANNERED_BLOCKER_KINDS.has('lineage')).toBe(false);
    expect(BANNERED_BLOCKER_KINDS.has('local-unreadable')).toBe(false);
  });
});
