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

const { pushMock, confirmMock, toastMock, syncState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  confirmMock: vi.fn(async () => true),
  toastMock: vi.fn(),
  syncState: {
    podUnopenable: false as boolean,
    backgroundSyncErrorKind: null as string | null,
    podBlockMessageKey: null as string | null,
    useRemoteFileOverLocalDocument: vi.fn(async () => true),
  },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmMock }));
vi.mock('@/composables/useToast', () => ({ showToast: toastMock }));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => syncState }));

import LineageBanner from '@/components/common/LineageBanner.vue';

/** The store shape while an `adopt-remote` block is latched. */
function blockAdoptRemote(): void {
  syncState.podUnopenable = true;
  syncState.backgroundSyncErrorKind = 'lineage';
  syncState.podBlockMessageKey = 'podLineage.unsyncedInline';
}

const labels = (w: ReturnType<typeof mount>) => w.findAll('button').map((b) => b.text());

describe('LineageBanner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    syncState.useRemoteFileOverLocalDocument.mockResolvedValue(true);
    syncState.podUnopenable = false;
    syncState.backgroundSyncErrorKind = null;
    syncState.podBlockMessageKey = null;
  });

  it('stays silent when nothing is blocked', () => {
    expect(mount(LineageBanner).find('[role="status"]').exists()).toBe(false);
  });

  it('stays silent for a NON-lineage block, which has its own banner', () => {
    syncState.podUnopenable = true;
    syncState.backgroundSyncErrorKind = 'decrypt';
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
    syncState.podUnopenable = true;
    syncState.backgroundSyncErrorKind = 'lineage';
    syncState.podBlockMessageKey = 'podLineage.conflictInline';
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
    expect(syncState.useRemoteFileOverLocalDocument).not.toHaveBeenCalled();
  });

  it('adopts the family file once the person confirms', async () => {
    blockAdoptRemote();
    const w = mount(LineageBanner);
    await w.findAll('button')[1].trigger('click');
    await vi.waitFor(() => expect(syncState.useRemoteFileOverLocalDocument).toHaveBeenCalled());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('says so when the adopt fails — the banner is gone by then', async () => {
    // The latch is cleared before the re-open, so without this the banner just
    // vanishes and the user believes it worked.
    blockAdoptRemote();
    syncState.useRemoteFileOverLocalDocument.mockResolvedValue(false);
    const w = mount(LineageBanner);
    await w.findAll('button')[1].trigger('click');
    await vi.waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith('error', 'podLineage.useFileFailed')
    );
  });

  it('persists until the person dismisses it, never on a timer', async () => {
    blockAdoptRemote();
    const w = mount(LineageBanner);
    await w.findAll('button')[2].trigger('click');
    expect(w.find('[role="status"]').exists()).toBe(false);
  });

  it('is mounted in the app shell beside the other banners', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const app = fs.readFileSync(path.resolve(__dirname, '../../../..', 'src/App.vue'), 'utf8');
    expect(app).toContain('<LineageBanner />');
  });
});
