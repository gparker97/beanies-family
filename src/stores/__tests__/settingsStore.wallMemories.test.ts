/**
 * Family memories on the wall in the settings store (#140): the getter is always complete,
 * the two setters write through `patchWall` without touching the rest of the wall's device
 * object, they store only the fields set (so a default change still reaches the device), and
 * `patchWall` queues writes so two quick taps both land.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const saved = (patch: Record<string, unknown>) => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
    ...patch,
  });
  return {
    saved,
    saveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => saved(patch)),
    showToast: vi.fn(),
  };
});

vi.mock('@/composables/useToast', () => ({
  showToast: h.showToast,
  useToast: () => ({ toasts: [], dismissToast: vi.fn() }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ id: 'global_settings', theme: 'light', language: 'en' }),
  getGlobalSettings: vi.fn(async () => ({ id: 'global_settings', theme: 'light', language: 'en' })),
  saveGlobalSettings: h.saveGlobalSettings,
}));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', language: 'en', theme: 'light' })),
  saveSettings: vi.fn(async (patch: Record<string, unknown>) => ({ id: 'app_settings', ...patch })),
}));
vi.mock('@/services/automerge/docService', () => ({
  isDocLoaded: () => true,
  isAuthoritativeDocLoaded: () => true,
}));
vi.mock('@/services/automerge/projection', () => ({ getSettings: () => ({ id: 'app_settings' }) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { useSettingsStore } from '@/stores/settingsStore';
import { DEFAULT_WALL_MEMORIES } from '@/utils/wallMemories';

/** The `wall` object of the most recent save. */
const lastWall = () =>
  (h.saveGlobalSettings.mock.calls.at(-1)![0] as { wall: Record<string, unknown> }).wall;

/** Makes the next save resolve only after a macrotask, so queued writes really overlap. */
const slowSave = () =>
  h.saveGlobalSettings.mockImplementationOnce(
    (patch: Record<string, unknown>) =>
      new Promise<ReturnType<typeof h.saved>>((resolve) =>
        setTimeout(() => resolve(h.saved(patch)))
      )
  );

describe('settingsStore wall memories', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('the getter is the defaults when nothing is stored', () => {
    expect(useSettingsStore().wallMemories).toEqual(DEFAULT_WALL_MEMORIES);
  });

  it('setWallMemories changes the given fields and keeps the types', async () => {
    const store = useSettingsStore();
    await store.setWallMemoryType('saying', false);
    await store.setWallMemories({ slideshow: 'full', brightness: 'bright', speed: 'fast' });
    expect(lastWall().memories).toEqual({
      show: { saying: false },
      slideshow: 'full',
      brightness: 'bright',
      speed: 'fast',
    });
    expect(store.wallMemories.speed).toBe('fast');
    expect(store.wallMemories.slideshow).toBe('full');
    expect(store.wallMemories.show.saying).toBe(false);
  });

  it('stores only the field a fresh device set, so a later default change reaches it', async () => {
    const store = useSettingsStore();
    await store.setWallMemoryType('note', false);
    expect(lastWall().memories).toEqual({ show: { note: false } });
    await store.setWallSleep({ idleMinutes: 20 });
    expect(lastWall().sleep).toEqual({ idleMinutes: 20 });

    const defaults = DEFAULT_WALL_MEMORIES as { brightness: string; show: Record<string, boolean> };
    const was = defaults.brightness;
    try {
      defaults.brightness = 'bright'; // a later release changes a default
      expect(store.wallMemories.brightness).toBe('bright');
      expect(store.wallMemories.show.note).toBe(false);
    } finally {
      defaults.brightness = was;
    }
  });

  it('setWallMemoryType switches one type and keeps the others', async () => {
    const store = useSettingsStore();
    await store.setWallMemoryType('note', false);
    expect(store.wallMemories.show).toEqual({ ...DEFAULT_WALL_MEMORIES.show, note: false });
    await store.setWallMemoryType('note', true);
    expect(store.wallMemories.show).toEqual(DEFAULT_WALL_MEMORIES.show);
  });

  it('memory writes keep the sleep and weather settings, and theirs keep the memories', async () => {
    const store = useSettingsStore();
    await store.setWallSleep({ idleMinutes: 30 });
    await store.setWallWeather('small');
    await store.setWallMemories({ viewer: false });
    expect(lastWall()).toEqual({
      sleep: { idleMinutes: 30 },
      weather: 'small',
      memories: { viewer: false },
    });
    await store.setWallSleep({ idleMinutes: 45 });
    expect(store.wallMemories.viewer).toBe(false);
    expect(store.wallWeatherStyle).toBe('small');
  });

  it('two un-awaited taps both land (patchWall builds each patch on its turn)', async () => {
    const store = useSettingsStore();
    slowSave();
    const first = store.setWallMemoryType('note', false);
    const second = store.setWallMemoryType('saying', false);
    await Promise.all([first, second]);
    expect(h.saveGlobalSettings).toHaveBeenCalledTimes(2);
    expect(store.wallMemories.show).toEqual({
      ...DEFAULT_WALL_MEMORIES.show,
      note: false,
      saying: false,
    });
  });

  it('un-awaited writes across sleep, weather and memories all land', async () => {
    const store = useSettingsStore();
    slowSave();
    await Promise.all([
      store.setWallSleep({ idleMinutes: 15 }),
      store.setWallWeather('off'),
      store.setWallMemories({ brightness: 'bright' }),
    ]);
    expect(store.wallSleep.idleMinutes).toBe(15);
    expect(store.wallWeatherStyle).toBe('off');
    expect(store.wallMemories.brightness).toBe('bright');
  });

  it('a failed write toasts and rejects to its own caller, and the next write still lands', async () => {
    const store = useSettingsStore();
    h.saveGlobalSettings.mockRejectedValueOnce(new Error('disk full'));
    const failed = store.setWallMemoryType('favorite', false);
    const next = store.setWallMemories({ slideshow: 'off' });
    await expect(failed).rejects.toThrow('disk full');
    await expect(next).resolves.toBeUndefined();
    expect(h.showToast).toHaveBeenCalledWith(
      'error',
      'settings.persistFailed',
      'wall.setup.title',
      expect.objectContaining({ surface: 'settings-persist', context: { field: 'wall' } })
    );
    expect(store.wallMemories.show.favorite).toBe(true);
    expect(store.wallMemories.slideshow).toBe('off');
  });

  it('hands IndexedDB a wall it can clone: a memories write after a sleep write', async () => {
    const store = useSettingsStore();
    await store.setWallSleep({ idleMinutes: 15 });
    await store.setWallMemoryType('note', false);
    // structuredClone is what IndexedDB runs on a put; it throws DataCloneError on a
    // reactive proxy, which is how the other group's object used to arrive.
    expect(() => structuredClone(lastWall())).not.toThrow();
    expect((lastWall().sleep as { idleMinutes: number }).idleMinutes).toBe(15);
  });
});
