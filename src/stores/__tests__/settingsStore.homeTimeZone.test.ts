/**
 * Home time zone in the settings store: `ensureHomeTimeZone` (background backfill),
 * `setHomeTimeZone` (validated user write), the `setCountry` auto-fill and the
 * public-holidays toggle's report-on-failure contract.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  saveSettings: vi.fn(async (patch: Record<string, unknown>) => ({ id: 'app_settings', ...patch })),
  setShowPublicHolidays: vi.fn(async (show: boolean) => ({
    id: 'app_settings',
    showPublicHolidays: show,
  })),
  reportError: vi.fn(),
  logEvent: vi.fn(),
  showToast: vi.fn(),
  authoritative: vi.fn(() => true),
  projected: vi.fn((): Record<string, unknown> | null => ({ id: 'app_settings' })),
}));

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
  saveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'global_settings',
    ...patch,
  })),
}));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', language: 'en', theme: 'light' })),
  saveSettings: h.saveSettings,
  setShowPublicHolidays: h.setShowPublicHolidays,
}));
vi.mock('@/services/automerge/docService', () => ({
  isDocLoaded: () => true,
  isAuthoritativeDocLoaded: h.authoritative,
}));
vi.mock('@/services/automerge/projection', () => ({ getSettings: h.projected }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

import { useSettingsStore } from '@/stores/settingsStore';

const owner = { isOwner: true, canManagePod: true, rosterLoaded: true };
const backfillLogs = (detail?: string) =>
  h.logEvent.mock.calls.filter(
    ([e]) => e.context?.action === 'backfill' && (!detail || e.context.detail === detail)
  );

describe('settingsStore home time zone', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    h.authoritative.mockReturnValue(true);
    h.projected.mockReturnValue({ id: 'app_settings' });
  });

  describe('ensureHomeTimeZone', () => {
    it('does nothing before the doc is authoritative', async () => {
      h.authoritative.mockReturnValue(false);
      await useSettingsStore().ensureHomeTimeZone(owner);
      expect(h.saveSettings).not.toHaveBeenCalled();
      expect(h.logEvent).not.toHaveBeenCalled();
    });

    it('does nothing before the roster is loaded', async () => {
      await useSettingsStore().ensureHomeTimeZone({ ...owner, rosterLoaded: false });
      expect(h.saveSettings).not.toHaveBeenCalled();
    });

    it('does nothing when a zone is already stored', async () => {
      h.projected.mockReturnValue({ id: 'app_settings', homeTimeZone: 'Asia/Tokyo' });
      await useSettingsStore().ensureHomeTimeZone(owner);
      expect(h.saveSettings).not.toHaveBeenCalled();
    });

    it('persists the device zone from the owner when there is no country, and logs it', async () => {
      await useSettingsStore().ensureHomeTimeZone(owner);
      expect(h.saveSettings).toHaveBeenCalledTimes(1);
      const patch = h.saveSettings.mock.calls[0]![0] as { homeTimeZone: string };
      expect(typeof patch.homeTimeZone).toBe('string');
      expect(backfillLogs('persisted')).toHaveLength(1);
      expect(backfillLogs('persisted')[0]![0].context.kind).toBe('owner-device');
    });

    it('never writes from a non-owner device when there is no single-zone country', async () => {
      await useSettingsStore().ensureHomeTimeZone({ ...owner, isOwner: false });
      expect(h.saveSettings).not.toHaveBeenCalled();
      expect(backfillLogs('skipped-not-owner')).toHaveLength(1);
    });

    it('never writes without manage-pod permission', async () => {
      await useSettingsStore().ensureHomeTimeZone({
        isOwner: false,
        canManagePod: false,
        rosterLoaded: true,
      });
      expect(h.saveSettings).not.toHaveBeenCalled();
      expect(backfillLogs('skipped-no-permission')).toHaveLength(1);
    });

    it('logs a skip once per session per detail, and again after resetState', async () => {
      const store = useSettingsStore();
      const member = { isOwner: false, canManagePod: true, rosterLoaded: true };
      await store.ensureHomeTimeZone(member);
      await store.ensureHomeTimeZone(member);
      await store.ensureHomeTimeZone(member);
      expect(backfillLogs('skipped-not-owner')).toHaveLength(1);
      store.resetState();
      await store.ensureHomeTimeZone(member);
      expect(backfillLogs('skipped-not-owner')).toHaveLength(2);
    });

    it('re-evaluates after a skip once the inputs change (no stale in-flight promise)', async () => {
      const store = useSettingsStore();
      // A non-owner admin with no country skips...
      await store.ensureHomeTimeZone({ isOwner: false, canManagePod: true, rosterLoaded: true });
      expect(h.saveSettings).not.toHaveBeenCalled();
      // ...then the family country becomes single-zone: the next trigger must write.
      const sg = (() => {
        try {
          return (
            new Intl.Locale('und-SG') as unknown as { getTimeZones?: () => string[] }
          ).getTimeZones?.();
        } catch {
          return undefined;
        }
      })();
      if (!sg || sg.length !== 1) return; // engine without zone data: covered elsewhere
      h.projected.mockReturnValue({ id: 'app_settings', country: 'SG' });
      await store.ensureHomeTimeZone({ isOwner: false, canManagePod: true, rosterLoaded: true });
      expect(h.saveSettings).toHaveBeenCalledWith({ homeTimeZone: 'Asia/Singapore' });
    });

    it('never persists a synthetic zone when the engine reports none', async () => {
      const spy = vi
        .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
        .mockReturnValue({ timeZone: undefined } as unknown as Intl.ResolvedDateTimeFormatOptions);
      try {
        await useSettingsStore().ensureHomeTimeZone(owner);
        expect(h.saveSettings).not.toHaveBeenCalled();
        expect(backfillLogs('skipped-device-zone-unknown')).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('writes once for concurrent triggers', async () => {
      const store = useSettingsStore();
      await Promise.all([store.ensureHomeTimeZone(owner), store.ensureHomeTimeZone(owner)]);
      expect(h.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('reports a warning and never throws when the write fails', async () => {
      h.saveSettings.mockRejectedValueOnce(new Error('boom'));
      await expect(useSettingsStore().ensureHomeTimeZone(owner)).resolves.toBeUndefined();
      expect(h.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'home-time-zone',
          severity: 'warning',
          context: { action: 'backfill' },
        })
      );
    });

    it('can retry after a failure (in-flight cleared)', async () => {
      const store = useSettingsStore();
      h.saveSettings.mockRejectedValueOnce(new Error('boom'));
      await store.ensureHomeTimeZone(owner);
      await store.ensureHomeTimeZone(owner);
      expect(h.saveSettings).toHaveBeenCalledTimes(2);
    });
  });

  describe('setHomeTimeZone', () => {
    it('persists a valid zone and logs the kind', async () => {
      await useSettingsStore().setHomeTimeZone('Asia/Singapore');
      expect(h.saveSettings).toHaveBeenCalledWith({ homeTimeZone: 'Asia/Singapore' });
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'home-time-zone',
          context: { action: 'set', kind: 'user' },
        })
      );
    });

    it('rejects an invalid zone without writing, toasting and rethrowing', async () => {
      await expect(useSettingsStore().setHomeTimeZone('Not/AZone')).rejects.toThrow(/invalid IANA/);
      expect(h.saveSettings).not.toHaveBeenCalled();
      expect(h.showToast).toHaveBeenCalled();
      expect(h.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('setCountry', () => {
    it('moves an already-stored zone to a single-zone country', async () => {
      h.projected.mockReturnValue({ id: 'app_settings', homeTimeZone: 'Europe/London' });
      await useSettingsStore().setCountry('SG');
      expect(h.saveSettings).toHaveBeenCalledWith({ country: 'SG' });
      // Engines without Intl.Locale zone data cannot say; only assert when they can.
      const wrote = h.saveSettings.mock.calls.some(
        ([p]) => (p as { homeTimeZone?: string }).homeTimeZone === 'Asia/Singapore'
      );
      const knows = (new Intl.Locale('und-SG') as unknown as { getTimeZones?: () => string[] })
        .getTimeZones;
      if (knows) {
        expect(wrote).toBe(true);
        expect(h.logEvent).toHaveBeenCalledWith(
          expect.objectContaining({ context: { action: 'set', kind: 'country-pick' } })
        );
      }
    });

    it('logs when a country change cannot move the stored zone (no zone data on this engine)', async () => {
      h.projected.mockReturnValue({ id: 'app_settings', homeTimeZone: 'Asia/Singapore' });
      const spy = vi
        .spyOn(Intl, 'Locale')
        .mockImplementation((() => ({})) as unknown as typeof Intl.Locale);
      try {
        await useSettingsStore().setCountry('GB');
      } finally {
        spy.mockRestore();
      }
      expect(h.saveSettings).not.toHaveBeenCalledWith(
        expect.objectContaining({ homeTimeZone: expect.anything() })
      );
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { action: 'set', kind: 'country-pick', detail: 'skipped-zones-unknown' },
        })
      );
    });

    it('re-picking the SAME country never moves a deliberately chosen zone', async () => {
      h.projected.mockReturnValue({
        id: 'app_settings',
        country: 'GB',
        homeTimeZone: 'Europe/Dublin',
      });
      await useSettingsStore().setCountry('GB');
      expect(h.saveSettings).not.toHaveBeenCalledWith(
        expect.objectContaining({ homeTimeZone: expect.anything() })
      );
    });

    it('does not write a zone while none is stored (the backfill is the one writer)', async () => {
      await useSettingsStore().setCountry('SG');
      expect(h.saveSettings.mock.calls.some(([p]) => 'homeTimeZone' in (p as object))).toBe(false);
    });

    it('leaves the zone alone for a multi-zone country', async () => {
      h.projected.mockReturnValue({ id: 'app_settings', homeTimeZone: 'Europe/London' });
      await useSettingsStore().setCountry('US');
      expect(h.saveSettings.mock.calls.some(([p]) => 'homeTimeZone' in (p as object))).toBe(false);
    });
  });

  describe('setShowPublicHolidays', () => {
    it('persists through the repo', async () => {
      const store = useSettingsStore();
      await store.setShowPublicHolidays(false);
      expect(h.setShowPublicHolidays).toHaveBeenCalledWith(false);
      expect(store.settings.showPublicHolidays).toBe(false);
    });

    it('toasts and rethrows on failure so the toggle reverts', async () => {
      h.setShowPublicHolidays.mockRejectedValueOnce(new Error('write failed'));
      await expect(useSettingsStore().setShowPublicHolidays(false)).rejects.toThrow('write failed');
      expect(h.showToast).toHaveBeenCalledWith(
        'error',
        'settings.persistFailed',
        'settings.showPublicHolidays',
        expect.anything()
      );
    });
  });
});
