/**
 * The lineage warning must be dismissed by a PERSON, not by a timer — and it
 * must offer a recovery that actually resolves the block.
 *
 * ⚠️ WHY. It reached the user as a transient toast over a 3px bar with no text
 * node, and during the first real two-session test greg missed it entirely and
 * reported the block as "the data just didn't sync". A message that says
 * unsaved work is at risk cannot be missable by looking at another window.
 *
 * ⚠️ AND WHY THIS FILE IS MOUNTED, NOT GREPPED. The version it replaces asserted
 * SOURCE TEXT — `expect(src).toContain("backgroundSyncErrorKind === 'lineage'")`
 * — which passes for a component that renders nothing, and fails for a correct
 * refactor that spells the same condition differently. Every assertion below is
 * on rendered output or on a call that actually happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const { pushMock, confirmMock, toastMock, holder } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  confirmMock: vi.fn(async () => true),
  toastMock: vi.fn(),
  // ⚠️ A HOLDER, filled by the mock factory with a REACTIVE object. A plain
  // object works for "mount with this state", but every assertion about a state
  // CHANGE on an already-mounted banner — the dismissal re-arm especially —
  // silently passes or fails for the wrong reason, because mutating a plain
  // object triggers no Vue effect.
  holder: {
    store: null as unknown as {
      podUnopenable: boolean;
      backgroundSyncErrorKind: string | null;
      podBlockMessageKey: string | null;
      useRemoteFileOverLocalDocument: ReturnType<typeof vi.fn>;
    },
  },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmMock }));
vi.mock('@/composables/useToast', () => ({ showToast: toastMock }));
vi.mock('@/stores/syncStore', async () => {
  const { reactive } = await import('vue');
  holder.store = reactive({
    podUnopenable: false,
    backgroundSyncErrorKind: null as string | null,
    podBlockMessageKey: null as string | null,
    useRemoteFileOverLocalDocument: vi.fn(async () => true),
  });
  return { useSyncStore: () => holder.store };
});

import LineageBanner from '@/components/common/LineageBanner.vue';

/** The store shape while an `adopt-remote` block is latched. */
function blockAdoptRemote(): void {
  holder.store.podUnopenable = true;
  holder.store.backgroundSyncErrorKind = 'lineage';
  holder.store.podBlockMessageKey = 'podLineage.unsyncedInline';
}

const labels = (w: ReturnType<typeof mount>) => w.findAll('button').map((b) => b.text());

describe('LineageBanner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    holder.store.useRemoteFileOverLocalDocument.mockReset();
    holder.store.useRemoteFileOverLocalDocument.mockResolvedValue(true);
    holder.store.podUnopenable = false;
    holder.store.backgroundSyncErrorKind = null;
    holder.store.podBlockMessageKey = null;
  });

  it('stays silent when nothing is blocked', () => {
    expect(mount(LineageBanner).find('[role="status"]').exists()).toBe(false);
  });

  it('stays silent for a NON-lineage block, which has its own banner', () => {
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'decrypt';
    expect(mount(LineageBanner).find('[role="status"]').exists()).toBe(false);
  });

  it('shows the recoverable copy and BOTH recovery actions on adopt-remote', () => {
    blockAdoptRemote();
    const w = mount(LineageBanner);
    const banner = w.find('[role="status"]'); // notice tone, never Alert Red
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('podLineage.bannerTitle');
    expect(banner.text()).toContain('podLineage.bannerMessage');
    expect(labels(w)).toEqual(['podLineage.bannerCta', 'podLineage.useFileCta', 'action.dismiss']);
  });

  it('shows the CONFLICT copy and offers NO discard on a conflict', () => {
    // Two devices compacted at the same moment. Nothing the user can safely
    // choose between, so offering "use the family file" would invite them to
    // throw away one of two equally valid reorganisations.
    holder.store.podUnopenable = true;
    holder.store.backgroundSyncErrorKind = 'lineage';
    holder.store.podBlockMessageKey = 'podLineage.conflictInline';
    const w = mount(LineageBanner);
    expect(w.find('[role="status"]').text()).toContain('podLineage.conflictTitle');
    expect(w.find('[role="status"]').text()).toContain('podLineage.conflictInline');
    expect(labels(w)).toEqual(['action.dismiss']);
  });

  it('routes the export CTA to the Settings family-data modal', async () => {
    blockAdoptRemote();
    const w = mount(LineageBanner);
    await w.findAll('button')[0].trigger('click');
    expect(pushMock).toHaveBeenCalledWith({ path: '/settings', query: { open: 'family-data' } });
  });

  it("confirms BEFORE discarding this device's unsynced document", async () => {
    blockAdoptRemote();
    confirmMock.mockResolvedValue(false);
    const w = mount(LineageBanner);
    await w.findAll('button')[1].trigger('click');
    expect(confirmMock).toHaveBeenCalled();
    expect(holder.store.useRemoteFileOverLocalDocument).not.toHaveBeenCalled();
  });

  it('adopts the family file once the person confirms', async () => {
    blockAdoptRemote();
    const w = mount(LineageBanner);
    await w.findAll('button')[1].trigger('click');
    await vi.waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('success', 'podLineage.useFileDone')
    );
  });

  it('says so when the adopt fails — the banner is gone by then', async () => {
    // The latch is cleared before the re-open, so without this the banner just
    // vanishes and the user believes it worked.
    blockAdoptRemote();
    holder.store.useRemoteFileOverLocalDocument.mockResolvedValue(false);
    const w = mount(LineageBanner);
    await w.findAll('button')[1].trigger('click');
    await vi.waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('error', 'podLineage.useFileFailed')
    );
  });

  it('persists until the person dismisses it', async () => {
    blockAdoptRemote();
    const w = mount(LineageBanner);
    await w.findAll('button')[2].trigger('click');
    expect(w.find('[role="status"]').exists()).toBe(false);
  });

  it('is NOT dismissed by a timer', async () => {
    // ⚠️ THE HALF THE MOUNTED REWRITE LOST. The grep suite this replaced asserted
    // `not.toContain('setTimeout')`; without a replacement, adding a 5s
    // self-dismiss — the exact defect this component exists to fix — left all ten
    // tests green. Fake timers assert the behaviour rather than the source.
    vi.useFakeTimers();
    try {
      // ⚠️ MOUNT UNBLOCKED, THEN BLOCK. `watch` is not `immediate`, so a banner
      // that mounts already-blocked never runs the watcher — and a self-dismiss
      // timer scheduled inside it would never be armed in the test either. My
      // first version of this test made exactly that mistake and passed under
      // the mutation it was written to catch. Verified by mutation.
      const w = mount(LineageBanner);
      expect(w.find('[role="status"]').exists()).toBe(false);
      blockAdoptRemote();
      await w.vm.$nextTick();
      expect(w.find('[role="status"]').exists()).toBe(true);
      await vi.advanceTimersByTimeAsync(120_000);
      await w.vm.$nextTick();
      expect(w.find('[role="status"]').exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms after a dismissal, so a NEW block speaks again', async () => {
    // The user dismissed the LAST block, not every future one. Deleting the
    // `watch(blocked, …)` left the rewritten suite green.
    blockAdoptRemote();
    const w = mount(LineageBanner);
    await w.findAll('button')[2].trigger('click');
    expect(w.find('[role="status"]').exists()).toBe(false);

    // The latch clears (a successful read), then a new block arrives.
    holder.store.podUnopenable = false;
    holder.store.backgroundSyncErrorKind = null;
    await w.vm.$nextTick();
    blockAdoptRemote();
    await w.vm.$nextTick();
    expect(w.find('[role="status"]').exists()).toBe(true);
  });

  it('ignores a second click while the confirmation is still open', async () => {
    // ⚠️ THE UNGUARDED WINDOW IS THE DIALOG, not the download. While `confirm`
    // is open the button is not yet disabled, so this is the only moment two
    // clicks can both get through — and the flag has to be claimed before the
    // await for the guard to cover it. Verified by mutation: with the claim
    // moved back after the confirm, this fails.
    blockAdoptRemote();
    let allow: (v: boolean) => void = () => {};
    confirmMock.mockReturnValue(
      new Promise<boolean>((r) => {
        allow = r;
      })
    );
    const w = mount(LineageBanner);
    await w.findAll('button')[1].trigger('click');
    await w.findAll('button')[1].trigger('click');
    allow(true);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await w.vm.$nextTick();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(holder.store.useRemoteFileOverLocalDocument).toHaveBeenCalledTimes(1)
    );
  });

  it('says so when the adopt THROWS, not only when it returns false', async () => {
    // `loadFromFile` throws by design on a remote blocker, and the latch has
    // already been cleared by then — a bare `finally` leaves the banner gone and
    // the user believing it worked.
    blockAdoptRemote();
    holder.store.useRemoteFileOverLocalDocument.mockRejectedValue(new Error('boom'));
    const w = mount(LineageBanner);
    await w.findAll('button')[1].trigger('click');
    await vi.waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('error', 'podLineage.useFileFailed')
    );
  });

  it('is mounted in the app shell beside the other banners', async () => {
    // The ONE grep left, and deliberately so: "is this component in the tree at
    // all?" is a wiring question with no runtime surface a unit test can reach.
    // Matched on the tag name only, so reformatting the template cannot fail it
    // — the previous form broke on `<LineageBanner/>` with no space.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const app = fs.readFileSync(path.resolve(__dirname, '../../../..', 'src/App.vue'), 'utf8');
    expect(app).toMatch(/<LineageBanner\s*\/?>/);
  });
});
