/**
 * The wall is a `noChrome` route that renders NONE of App.vue's banners, so
 * this stamp is its only warning channel. A silent green dot over a pod that
 * cannot be opened is the exact failure the wall is positioned against.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const { syncState, onlineState } = vi.hoisted(() => ({
  syncState: {
    saveStatus: 'saved' as string,
    lastSync: '2026-09-06T10:00:00.000Z' as string | null,
    driveFileNotFound: false,
    podAccessError: null as unknown,
    cachePersistFailed: false,
    podUnopenable: false,
    backgroundSyncErrorKind: null as string | null,
  },
  onlineState: { isOnline: { value: true } },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useOnline', () => ({ useOnline: () => onlineState }));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => syncState }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import WallStatusStamp from '@/components/wall/WallStatusStamp.vue';

describe('WallStatusStamp', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    Object.assign(syncState, {
      saveStatus: 'saved',
      lastSync: '2026-09-06T10:00:00.000Z',
      driveFileNotFound: false,
      podAccessError: null,
      cachePersistFailed: false,
      podUnopenable: false,
      backgroundSyncErrorKind: null,
    });
    onlineState.isOnline.value = true;
  });

  it('speaks for EVERY blocker class, not just the lineage one', () => {
    // ⚠️ THE REGRESSION THIS PINS. The condition was
    // `backgroundSyncErrorKind === 'lineage'`, which covered the lineage block
    // and MISSED every payload one — a pod that could not be decrypted, or was
    // too large for the device, latched the poller off while this stamp went on
    // showing a green dot and "saved 4 minutes ago".
    syncState.podUnopenable = true;
    syncState.backgroundSyncErrorKind = 'decrypt';
    expect(mount(WallStatusStamp).text()).toContain('wall.status.blocked');
  });

  it('does not say "can\'t reach" about a file it read perfectly well', () => {
    // A lineage block reached the file and DECLINED it. "Can't reach your family
    // file" sends the family to check their wifi for a problem no network fixes.
    syncState.podUnopenable = true;
    syncState.backgroundSyncErrorKind = 'lineage';
    const text = mount(WallStatusStamp).text();
    expect(text).toContain('wall.status.needsAttention');
    expect(text).not.toContain('wall.status.blocked');
  });

  it('shows a healthy stamp when nothing is wrong', () => {
    const w = mount(WallStatusStamp);
    expect(w.text()).toContain('wall.status.saved');
    expect(w.text()).not.toContain('wall.status.blocked');
    expect(w.text()).not.toContain('wall.status.needsAttention');
  });

  // Each arm INDIVIDUALLY — the previous single-flag version stayed green when
  // both `podAccessError` and `cachePersistFailed` were dropped from `blocked`.
  it.each([
    ['driveFileNotFound', () => (syncState.driveFileNotFound = true)],
    ['podAccessError', () => (syncState.podAccessError = { code: 'NO_HOME' })],
    ['cachePersistFailed', () => (syncState.cachePersistFailed = true)],
  ])('still reports %s, which has no saveStatus of its own', (_name, set) => {
    set();
    expect(mount(WallStatusStamp).text()).toContain('wall.status.blocked');
  });
});
