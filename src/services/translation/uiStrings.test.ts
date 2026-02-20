import { describe, it, expect } from 'vitest';
import {
  UI_STRINGS,
  BEANIE_STRINGS,
  getSourceText,
  getAllKeys,
  getStringHash,
  getAllHashes,
} from './uiStrings';
import type { UIStringKey } from './uiStrings';

describe('uiStrings', () => {
  describe('BEANIE_STRINGS', () => {
    it('every key in BEANIE_STRINGS also exists in UI_STRINGS', () => {
      const uiKeys = new Set(Object.keys(UI_STRINGS));
      for (const key of Object.keys(BEANIE_STRINGS)) {
        expect(uiKeys.has(key), `BEANIE_STRINGS key "${key}" not found in UI_STRINGS`).toBe(true);
      }
    });

    it('no BEANIE_STRINGS value is empty or whitespace-only', () => {
      for (const [key, value] of Object.entries(BEANIE_STRINGS)) {
        expect(
          value!.trim().length > 0,
          `BEANIE_STRINGS["${key}"] is empty or whitespace-only`
        ).toBe(true);
      }
    });

    it('BEANIE_STRINGS is a strict subset of UI_STRINGS keys', () => {
      const beanieKeys = Object.keys(BEANIE_STRINGS);
      const uiKeys = Object.keys(UI_STRINGS);
      expect(beanieKeys.length).toBeLessThan(uiKeys.length);
      expect(beanieKeys.every((k) => k in UI_STRINGS)).toBe(true);
    });

    it('has at least 100 beanie overrides', () => {
      expect(Object.keys(BEANIE_STRINGS).length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('UI_STRINGS', () => {
    it('values match getSourceText() output', () => {
      const keys = getAllKeys();
      for (const key of keys) {
        expect(UI_STRINGS[key]).toBe(getSourceText(key));
      }
    });

    it('has all expected key namespaces', () => {
      const keys = getAllKeys();
      const namespaces = new Set(keys.map((k) => k.split('.')[0]));
      expect(namespaces).toContain('app');
      expect(namespaces).toContain('nav');
      expect(namespaces).toContain('dashboard');
      expect(namespaces).toContain('accounts');
      expect(namespaces).toContain('transactions');
      expect(namespaces).toContain('assets');
      expect(namespaces).toContain('goals');
      expect(namespaces).toContain('family');
      expect(namespaces).toContain('settings');
    });
  });

  describe('hash functions', () => {
    it('getStringHash returns a non-empty string for all keys', () => {
      const keys = getAllKeys();
      for (const key of keys) {
        const hash = getStringHash(key);
        expect(hash.length).toBeGreaterThan(0);
      }
    });

    it('getAllHashes returns a hash for every key', () => {
      const keys = getAllKeys();
      const hashes = getAllHashes();
      for (const key of keys) {
        expect(hashes[key]).toBeDefined();
        expect(hashes[key].length).toBeGreaterThan(0);
      }
    });

    it('different strings produce different hashes', () => {
      const hash1 = getStringHash('dashboard.netWorth' as UIStringKey);
      const hash2 = getStringHash('dashboard.assets' as UIStringKey);
      expect(hash1).not.toBe(hash2);
    });
  });
});
