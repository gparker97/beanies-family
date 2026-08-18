import type { MealPlanEntry, MealSlot } from '@/types/models';

/**
 * Resolvers + labels the share formatter needs, injected so this stays a pure,
 * testable function (no store imports). The caller (the share surface) provides
 * i18n-resolved labels and name lookups.
 */
export interface MealShareContext {
  /** Header line, e.g. "🍲 beanies meal plan · Aug 18–24". */
  header: string;
  /** Localized day heading for a date, e.g. "Mon — Aug 18". */
  dayLabel: (dateISO: string) => string;
  /** Localized slot label, e.g. "Dinner". */
  slotLabel: (slot: MealSlot) => string;
  /** Display name for a meal — recipe name, or the type label (Eat out / Leftovers / …). */
  mealName: (meal: MealPlanEntry) => string;
  /** Cook's display name, or undefined when unassigned. */
  cookName: (memberId?: string) => string | undefined;
}

/**
 * Build a readable, markdown-free plain-text meal plan for sharing (WhatsApp,
 * SMS, etc.). Meals are assumed pre-sorted by date → slot → position. Groups by
 * day with an indented line per meal; appends the cook in parentheses when set.
 */
export function formatMealPlanShare(meals: MealPlanEntry[], ctx: MealShareContext): string {
  const lines: string[] = [ctx.header];
  let lastDate = '';
  for (const m of meals) {
    if (m.date !== lastDate) {
      lines.push('', ctx.dayLabel(m.date));
      lastDate = m.date;
    }
    const cook = ctx.cookName(m.cookMemberId);
    lines.push(`  ${ctx.slotLabel(m.slot)}: ${ctx.mealName(m)}${cook ? ` (${cook})` : ''}`);
  }
  return lines.join('\n');
}
