/**
 * The refusal has to be VISIBLE, and these are the tests that prove it.
 *
 * ⚠️ WHY THIS FILE EXISTS. When the local cache could not be READ, the app used
 * to treat the device as empty and install the family file wholesale, silently
 * destroying work that had never been saved. The fix refuses instead — but a
 * refusal nobody can see is only a quieter version of the same bug, and this
 * repo has now shipped that exact defect three times by three different doors:
 *
 *   1. `564b0662` — a refusal whose only render site sat inside a dead `v-if`.
 *   2. A non-latching blocker: `notePodUnopenable` early-returns before the
 *      message key is assigned when `latches` is false, so nothing rendered.
 *   3. `mirrorServiceLatch` carrying a SECOND copy of the kind ternary, which
 *      the 10s poll runs immediately after `notePodUnopenable` — overwriting
 *      `'local-unreadable'` with `'decrypt'` in the same tick.
 *
 * Cases 1 and 2 are covered by the RENDER tests below (mounted, asserting
 * output — never source text, per `lineageBanner.test.ts`'s header). Case 3 is
 * covered by the CLASSIFICATION tests: both store sites now call the exported
 * `blockerErrorKind`, so the table is what both of them agree on, and it is
 * asserted directly rather than through the store's private functions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import LocalDocUnreadableBanner from '@/components/common/LocalDocUnreadableBanner.vue';
import { BLOCKER_BANNER_KIND, BLOCKER_KINDS, blockerErrorKind } from '@/stores/syncStore';
import { LocalDocUnreadableError, RemoteMergeError, CorruptPayloadError } from '@/types/sync';

// `vi.hoisted`: these are referenced inside `vi.mock` factories, which are
// hoisted above ordinary top-level consts.
const { confirmMock, toastMock, useFileMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async () => true),
  toastMock: vi.fn(),
  useFileMock: vi.fn(async () => true),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmMock }));
vi.mock('@/composables/useToast', () => ({ showToast: toastMock }));

// Same holder pattern as `lineageBanner.test.ts`: the banner's contract is with
// the store's PUBLIC flags, so the store is mocked and the flags are set.
const holder = vi.hoisted(() => ({
  store: {
    podUnopenable: false,
    backgroundSyncErrorKind: null as string | null,
    useRemoteFileOverLocalDocument: vi.fn(async () => true),
  },
}));
vi.mock('@/stores/syncStore', async (importOriginal) => {
  // The classification half is the REAL module — it is pure and is what the two
  // store call sites share. Only the store factory is replaced.
  const actual = await importOriginal<typeof import('@/stores/syncStore')>();
  return { ...actual, useSyncStore: () => holder.store };
});

function mountBanner() {
  return mount(LocalDocUnreadableBanner, {
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

describe('LocalDocUnreadableBanner — render', () => {
  beforeEach(() => {
    holder.store.podUnopenable = false;
    holder.store.backgroundSyncErrorKind = null;
    holder.store.useRemoteFileOverLocalDocument = useFileMock;
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  it('renders for a local-unreadable block', () => {
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'local-unreadable';
    expect(mountBanner().text()).toContain('podLocalUnreadable.title');
  });

  it('stays silent for a lineage block, so it cannot steal that banner', () => {
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'lineage';
    expect(mountBanner().text()).toBe('');
  });

  it('stays silent for a decrypt block', () => {
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'decrypt';
    expect(mountBanner().text()).toBe('');
  });

  it('stays silent once the block clears', () => {
    holder.store.podUnopenable = false;
    holder.store.backgroundSyncErrorKind = 'local-unreadable';
    expect(mountBanner().text()).toBe('');
  });

  it('its recovery action reaches the store, behind a danger confirm', async () => {
    // ⚠️ THE ACTION MUST WORK, or the banner is a dead end. This calls
    // `useRemoteFileOverLocalDocument`, which re-enters the same load path with
    // `userChoseThisFile: true` — which is exactly why the refusal skips
    // `chosenByUser`. Without that skip the one button offered to resolve the
    // block would re-raise it, forever.
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'local-unreadable';
    const wrapper = mountBanner();

    await wrapper.findAll('button')[0]!.trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(useFileMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the confirm is declined', async () => {
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'local-unreadable';
    confirmMock.mockResolvedValue(false);
    const wrapper = mountBanner();

    await wrapper.findAll('button')[0]!.trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(useFileMock).not.toHaveBeenCalled();
  });
});

describe('blockerErrorKind — the classification both store sites share', () => {
  it('sends the local-cache blocker to its OWN banner, not decrypt', () => {
    // The bug: `err instanceof PodLineageError ? 'lineage' : 'decrypt'` sent
    // every non-lineage blocker to `'decrypt'`, whose banner tells the user
    // their password may have changed — for a failure that has nothing to do
    // with their password and where their data is at risk.
    expect(blockerErrorKind(new LocalDocUnreadableError('DeleteBlocked'))).toBe('local-unreadable');
  });

  it('leaves the existing classes exactly where they were', () => {
    expect(blockerErrorKind(new RemoteMergeError(new Error('duplicate seq 2')))).toBe('lineage');
    expect(blockerErrorKind(new CorruptPayloadError('boom', 'load', null))).toBe('decrypt');
  });

  it('is exhaustive, so a new blocker cannot silently inherit a banner', () => {
    // `satisfies Record<PodBlockMessageKey, …>` makes this a compile-time
    // guarantee; asserting it at runtime too means the table cannot be widened
    // with an index signature to "fix" a future build error.
    for (const kind of Object.values(BLOCKER_BANNER_KIND)) {
      expect(BLOCKER_KINDS.has(kind)).toBe(true);
    }
    expect(BLOCKER_KINDS.has('local-unreadable')).toBe(true);
  });

  it('excludes the kinds other paths own, so clearing cannot swallow them', () => {
    // `clearPodUnopenable` derives its clear-set from `BLOCKER_KINDS`. If
    // `auth-transient` or `network` leaked in, clearing a pod block would null a
    // message some other subsystem is still showing.
    expect(BLOCKER_KINDS.has('auth-transient')).toBe(false);
    expect(BLOCKER_KINDS.has('network')).toBe(false);
  });
});
