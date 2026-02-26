import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  writeSettingsWAL,
  readSettingsWAL,
  clearSettingsWAL,
  clearAllSettingsWAL,
  isWALStale,
} from '../settingsWAL';
import type { Settings } from '@/types/models';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    exchangeRateAutoUpdate: false,
    exchangeRateLastFetch: null,
    theme: 'system',
    language: 'en',
    syncEnabled: false,
    autoSyncEnabled: false,
    encryptionEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
    preferredCurrencies: ['GBP', 'EUR'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Settings;
}

describe('settingsWAL', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('writeSettingsWAL + readSettingsWAL', () => {
    it('writes and reads back settings for a family', () => {
      const settings = makeSettings({ preferredCurrencies: ['GBP', 'EUR'] });
      writeSettingsWAL('family-1', settings);

      const entry = readSettingsWAL('family-1');
      expect(entry).not.toBeNull();
      expect(entry!.familyId).toBe('family-1');
      expect(entry!.settings.preferredCurrencies).toEqual(['GBP', 'EUR']);
      expect(entry!.timestamp).toBeGreaterThan(0);
    });

    it('returns null for missing familyId', () => {
      expect(readSettingsWAL('nonexistent')).toBeNull();
    });

    it('returns null for familyId mismatch', () => {
      const settings = makeSettings();
      writeSettingsWAL('family-1', settings);

      // Tamper with the stored entry to simulate a mismatch
      const key = 'beanies_settings_wal_family-1';
      const raw = JSON.parse(localStorage.getItem(key)!);
      raw.familyId = 'family-2';
      localStorage.setItem(key, JSON.stringify(raw));

      expect(readSettingsWAL('family-1')).toBeNull();
    });

    it('returns null for corrupt JSON', () => {
      localStorage.setItem('beanies_settings_wal_family-1', '{bad json');
      expect(readSettingsWAL('family-1')).toBeNull();
    });

    it('overwrites previous entry on repeated writes', () => {
      writeSettingsWAL('family-1', makeSettings({ preferredCurrencies: ['GBP'] }));
      writeSettingsWAL('family-1', makeSettings({ preferredCurrencies: ['EUR', 'JPY'] }));

      const entry = readSettingsWAL('family-1');
      expect(entry!.settings.preferredCurrencies).toEqual(['EUR', 'JPY']);
    });
  });

  describe('clearSettingsWAL', () => {
    it('removes the entry for the given family', () => {
      writeSettingsWAL('family-1', makeSettings());
      writeSettingsWAL('family-2', makeSettings());

      clearSettingsWAL('family-1');

      expect(readSettingsWAL('family-1')).toBeNull();
      expect(readSettingsWAL('family-2')).not.toBeNull();
    });

    it('does not throw for missing entry', () => {
      expect(() => clearSettingsWAL('nonexistent')).not.toThrow();
    });
  });

  describe('clearAllSettingsWAL', () => {
    it('removes all WAL entries but leaves other localStorage keys', () => {
      writeSettingsWAL('family-1', makeSettings());
      writeSettingsWAL('family-2', makeSettings());
      localStorage.setItem('other_key', 'keep me');

      clearAllSettingsWAL();

      expect(readSettingsWAL('family-1')).toBeNull();
      expect(readSettingsWAL('family-2')).toBeNull();
      expect(localStorage.getItem('other_key')).toBe('keep me');
    });
  });

  describe('isWALStale', () => {
    it('returns false for fresh entries', () => {
      writeSettingsWAL('family-1', makeSettings());
      const entry = readSettingsWAL('family-1')!;
      expect(isWALStale(entry)).toBe(false);
    });

    it('returns true for entries older than maxAge', () => {
      writeSettingsWAL('family-1', makeSettings());
      const entry = readSettingsWAL('family-1')!;
      // Simulate old entry
      entry.timestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      expect(isWALStale(entry)).toBe(true);
    });

    it('respects custom maxAge', () => {
      writeSettingsWAL('family-1', makeSettings());
      const entry = readSettingsWAL('family-1')!;
      entry.timestamp = Date.now() - 5000; // 5 seconds ago
      expect(isWALStale(entry, 3000)).toBe(true);
      expect(isWALStale(entry, 10000)).toBe(false);
    });
  });

  describe('cross-family isolation', () => {
    it('keeps entries separate per familyId', () => {
      writeSettingsWAL('family-1', makeSettings({ preferredCurrencies: ['GBP'] }));
      writeSettingsWAL('family-2', makeSettings({ preferredCurrencies: ['EUR'] }));

      expect(readSettingsWAL('family-1')!.settings.preferredCurrencies).toEqual(['GBP']);
      expect(readSettingsWAL('family-2')!.settings.preferredCurrencies).toEqual(['EUR']);
    });
  });

  describe('localStorage unavailable', () => {
    it('silently degrades on write when localStorage throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      expect(() => writeSettingsWAL('family-1', makeSettings())).not.toThrow();
      spy.mockRestore();
    });

    it('returns null on read when localStorage throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });

      expect(readSettingsWAL('family-1')).toBeNull();
      spy.mockRestore();
    });

    it('does not throw on clear when localStorage throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });

      expect(() => clearSettingsWAL('family-1')).not.toThrow();
      expect(() => clearAllSettingsWAL()).not.toThrow();
      spy.mockRestore();
    });
  });
});
