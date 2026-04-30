import { describe, it, expect } from 'vitest';
import { isConflictFilename, CONFLICT_PATTERNS } from '../beanpodFilename';

describe('isConflictFilename', () => {
  describe('Dropbox patterns (auto-merge)', () => {
    const cases = [
      'family (conflicted copy 2026-04-30).beanpod',
      'our-family (conflicted copy 2025-12-01 14-30-22).beanpod',
      "kids (greg's conflicted copy 2026-04-29).beanpod",
      'family (Conflicted Copy 2026).beanpod', // case-insensitive
    ];
    for (const name of cases) {
      it(`matches "${name}"`, () => {
        const v = isConflictFilename(name);
        expect(v.isConflict).toBe(true);
        expect(v.provider).toBe('dropbox');
        expect(v.autoMerge).toBe(true);
      });
    }
  });

  describe('OneDrive patterns (auto-merge)', () => {
    const cases = [
      'family-conflict.beanpod',
      'family-conflict-1.beanpod',
      'family-laptop-conflict.beanpod', // OneDrive includes machine name as part of base
    ];
    // OneDrive's actual format puts the conflict suffix at the very end so
    // these all hit the regex.
    for (const name of cases) {
      it(`matches "${name}"`, () => {
        const v = isConflictFilename(name);
        expect(v.isConflict).toBe(true);
        expect(v.provider).toBe('onedrive');
        expect(v.autoMerge).toBe(true);
      });
    }
  });

  describe('Google Drive desktop patterns (auto-merge)', () => {
    const cases = ['family (1).beanpod', 'family (2).beanpod', 'family (10).beanpod'];
    for (const name of cases) {
      it(`matches "${name}"`, () => {
        const v = isConflictFilename(name);
        expect(v.isConflict).toBe(true);
        expect(v.provider).toBe('gdrive');
        expect(v.autoMerge).toBe(true);
      });
    }
  });

  describe('iCloud patterns (warn-only, autoMerge=false)', () => {
    const cases = ['family 2.beanpod', 'family 3.beanpod', 'family 99.beanpod'];
    for (const name of cases) {
      it(`matches "${name}" but does NOT auto-merge (false-positive risk)`, () => {
        const v = isConflictFilename(name);
        expect(v.isConflict).toBe(true);
        expect(v.provider).toBe('icloud');
        expect(v.autoMerge).toBe(false);
      });
    }
  });

  describe('non-matching filenames', () => {
    const cases = [
      'family.beanpod',
      'our-family.beanpod',
      'my_family.beanpod',
      'family-2026.beanpod', // hyphen-number, not space-number
      'family.json', // wrong extension
      'family (backup).beanpod', // user-chosen, no number/conflict suffix
      'conflict.beanpod', // word "conflict" alone, no separator
    ];
    for (const name of cases) {
      it(`does NOT match "${name}"`, () => {
        const v = isConflictFilename(name);
        expect(v.isConflict).toBe(false);
        expect(v.provider).toBeUndefined();
      });
    }
  });

  it('Dropbox pattern takes precedence over iCloud when both could match', () => {
    // "family (conflicted copy 2).beanpod" — has both the Dropbox phrase
    // AND a trailing digit before .beanpod. The Dropbox pattern is more
    // specific and listed first, so it wins.
    const v = isConflictFilename('family (conflicted copy 2).beanpod');
    expect(v.provider).toBe('dropbox');
  });

  it('exposes CONFLICT_PATTERNS for inspection', () => {
    expect(CONFLICT_PATTERNS.length).toBe(4);
    expect(CONFLICT_PATTERNS.map((p) => p.provider).sort()).toEqual([
      'dropbox',
      'gdrive',
      'icloud',
      'onedrive',
    ]);
  });
});
