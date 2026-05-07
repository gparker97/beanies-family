/**
 * Curated milestone-category catalogue.
 *
 * `MILESTONE_CATEGORIES` is the single source of truth driving:
 *   - the `MilestoneCategory` union in `@/types/models` (assertion-only:
 *     the types co-vary by string equality, so adding a category here
 *     also requires adding it to the union there. The `as const satisfies`
 *     pattern makes either-side drift fail at compile time.)
 *   - the picker grid in `MilestoneFormModal` — categories render under
 *     four expandable groups (Firsts / Achievements / Family / Celebrations)
 *     so the long flat list isn't overwhelming
 *   - the chip filters on `FamilyMilestones` and `FamilyScrapbookPage`
 *   - default-title fill-in on category change in the form
 *   - the i18n keys callers use to render labels
 *
 * Each entry carries a `group` field that drives the picker's section
 * structure. To add a category: append here AND to the union in
 * `@/types/models` (compile-time check via `as const satisfies` makes
 * drift impossible).
 *
 * Emoji values use Unicode escapes, matching the convention from
 * `quickAddItems.ts` / `navigation.ts`. Keeps the source ASCII and
 * rendering consistent across Chromium / WebKit / Firefox.
 */
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { MilestoneCategory } from '@/types/models';

export type MilestoneCategoryGroup = 'firsts' | 'achievements' | 'family' | 'celebrations';

interface MilestoneCategoryGroupShape {
  readonly id: MilestoneCategoryGroup;
  readonly emoji: string;
  readonly titleKey: UIStringKey;
}

/**
 * Group ordering = picker render order. "Firsts" leads because the typical
 * caller is a parent capturing kid moments. "Celebrations" trails (it's the
 * catch-all for Birthday + Custom).
 */
export const MILESTONE_CATEGORY_GROUPS = [
  { id: 'firsts', emoji: '\u{1F331}', titleKey: 'milestone.group.firsts' }, // 🌱
  { id: 'achievements', emoji: '\u{1F3C6}', titleKey: 'milestone.group.achievements' }, // 🏆
  { id: 'family', emoji: '\u{1F495}', titleKey: 'milestone.group.family' }, // 💕
  { id: 'celebrations', emoji: '\u{1F389}', titleKey: 'milestone.group.celebrations' }, // 🎉
] as const satisfies readonly MilestoneCategoryGroupShape[];

interface MilestoneCategoryShape {
  readonly id: MilestoneCategory;
  readonly group: MilestoneCategoryGroup;
  readonly emoji: string;
  readonly titleKey: UIStringKey;
}

export const MILESTONE_CATEGORIES = [
  // Firsts — early-childhood firsts
  { id: 'first_word', group: 'firsts', emoji: '\u{1F4AC}', titleKey: 'milestone.cat.firstWord' },
  { id: 'first_step', group: 'firsts', emoji: '\u{1F463}', titleKey: 'milestone.cat.firstStep' },
  {
    id: 'first_day_school',
    group: 'firsts',
    emoji: '\u{1F392}',
    titleKey: 'milestone.cat.firstDaySchool',
  },
  { id: 'lost_tooth', group: 'firsts', emoji: '\u{1F9B7}', titleKey: 'milestone.cat.lostTooth' },
  // Achievements — accomplishments with effort behind them
  {
    id: 'big_test',
    group: 'achievements',
    emoji: '\u{270F}\u{FE0F}',
    titleKey: 'milestone.cat.bigTest',
  },
  { id: 'recital', group: 'achievements', emoji: '\u{1F3B5}', titleKey: 'milestone.cat.recital' },
  { id: 'big_win', group: 'achievements', emoji: '\u{1F3C6}', titleKey: 'milestone.cat.bigWin' },
  {
    id: 'graduation',
    group: 'achievements',
    emoji: '\u{1F393}',
    titleKey: 'milestone.cat.graduation',
  },
  { id: 'license', group: 'achievements', emoji: '\u{1F697}', titleKey: 'milestone.cat.license' },
  // Family — events that touch the whole family unit
  {
    id: 'new_little_bean',
    group: 'family',
    emoji: '\u{1F476}',
    titleKey: 'milestone.cat.newLittleBean',
  },
  { id: 'new_home', group: 'family', emoji: '\u{1F3E1}', titleKey: 'milestone.cat.newHome' },
  { id: 'new_job', group: 'family', emoji: '\u{1F4BC}', titleKey: 'milestone.cat.newJob' },
  { id: 'new_pet', group: 'family', emoji: '\u{1F43E}', titleKey: 'milestone.cat.newPet' },
  { id: 'wedding', group: 'family', emoji: '\u{1F48D}', titleKey: 'milestone.cat.wedding' },
  { id: 'anniversary', group: 'family', emoji: '\u{1F495}', titleKey: 'milestone.cat.anniversary' },
  { id: 'big_trip', group: 'family', emoji: '\u{1F6EB}', titleKey: 'milestone.cat.bigTrip' },
  // Celebrations — annual + catch-all
  {
    id: 'birthday',
    group: 'celebrations',
    emoji: '\u{1F382}',
    titleKey: 'milestone.cat.birthday',
  },
  { id: 'custom', group: 'celebrations', emoji: '\u{2728}', titleKey: 'milestone.cat.custom' },
] as const satisfies readonly MilestoneCategoryShape[];

const ID_SET = new Set<string>(MILESTONE_CATEGORIES.map((c) => c.id));

export function isKnownMilestoneCategory(id: string): id is MilestoneCategory {
  return ID_SET.has(id);
}

export function getMilestoneCategory(id: MilestoneCategory): (typeof MILESTONE_CATEGORIES)[number] {
  // Linear scan over a 18-item list — no map needed; readability wins.
  const found = MILESTONE_CATEGORIES.find((c) => c.id === id);
  if (found) return found;
  // Caller passed a known-good MilestoneCategory but the list lost an entry.
  // Should never happen given the type union, but be loud if it does.
  throw new Error(`[milestoneCategories] no entry for id: ${id}`);
}
