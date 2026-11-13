import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHORE_STARTER_SETS,
  CHORE_TEMPLATE_TO_STARTER,
  choreStarterSet,
} from '@/constants/choreStarterSets';
import { LIST_TEMPLATES } from '@/constants/listTemplates';
import { UI_STRINGS } from '@/services/translation/uiStrings';
import { SCHOOL_DAYS, isChoreBlock } from '@/utils/chores';
import {
  CHORE_ART_OPTIONS,
  CHORE_BLOCK_META,
  CHORE_EMOJI_OPTIONS,
  choreArtSrc,
} from '@/constants/choreBlocks';

describe('choreboard starter sets (#146)', () => {
  it('has the four sets, School Morning on weekday mornings', () => {
    expect(CHORE_STARTER_SETS.map((s) => s.key)).toEqual([
      'school-morning',
      'bedtime',
      'pet-care',
      'tidy-up',
    ]);
    const school = choreStarterSet('school-morning');
    expect(school?.block).toBe('morning');
    expect(school?.days).toEqual([1, 2, 3, 4, 5]);
    expect(SCHOOL_DAYS).toEqual([1, 2, 3, 4, 5]);
    expect(choreStarterSet('bedtime')?.block).toBe('evening');
    expect(choreStarterSet('nope')).toBeUndefined();
  });

  it('every chore has a real string key, a valid block and unique key within its set', () => {
    for (const set of CHORE_STARTER_SETS) {
      expect(UI_STRINGS[set.nameKey]).toBeTruthy();
      expect(isChoreBlock(set.block)).toBe(true);
      expect(new Set(set.chores.map((c) => c.key)).size).toBe(set.chores.length);
      for (const c of set.chores) {
        expect(UI_STRINGS[c.titleKey], c.titleKey).toBeTruthy();
        expect(c.emoji).toBeTruthy();
        if (c.block) expect(isChoreBlock(c.block)).toBe(true);
      }
    }
  });

  it('every illustration exists under public/brand/cards/', () => {
    const keys = CHORE_STARTER_SETS.flatMap((s) => s.chores.flatMap((c) => c.illustration ?? []));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(existsSync(resolve(process.cwd(), 'public/brand/cards', `${key}.webp`)), key).toBe(
        true
      );
    }
  });

  it('the form’s art options exist, and every block and emoji has a real label', () => {
    for (const { key, labelKey } of CHORE_ART_OPTIONS) {
      expect(choreArtSrc(key)).toBe(`/brand/cards/${key}.webp`);
      expect(existsSync(resolve(process.cwd(), 'public/brand/cards', `${key}.webp`)), key).toBe(
        true
      );
      expect(UI_STRINGS[labelKey], labelKey).toBeTruthy();
    }
    expect(choreArtSrc(undefined)).toBeUndefined();
    for (const meta of Object.values(CHORE_BLOCK_META))
      expect(UI_STRINGS[meta.labelKey]).toBeTruthy();
    for (const o of CHORE_EMOJI_OPTIONS) expect(UI_STRINGS[o.labelKey], o.labelKey).toBeTruthy();
  });

  it('maps the two chore list templates to their starter sets', () => {
    expect(CHORE_TEMPLATE_TO_STARTER).toEqual({
      'before-school': 'school-morning',
      'kids-chores': 'tidy-up',
    });
    for (const [template, set] of Object.entries(CHORE_TEMPLATE_TO_STARTER)) {
      expect(
        LIST_TEMPLATES.some((t) => t.key === template),
        template
      ).toBe(true);
      expect(choreStarterSet(set)).toBeDefined();
    }
  });
});
