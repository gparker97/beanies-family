import type { MealPlanEntry } from '@/types/models';
import type { MealResolvers } from '@/utils/mealExportModel';

/**
 * The text share needs the shared meal resolvers (`dayLabel` / `slotLabel` /
 * `mealName` / `cook`) plus a header line. Reusing `MealResolvers` (rather than a
 * parallel shape) means the caller builds ONE resolver object and both the text
 * share and the grid export name/attribute every meal identically.
 */
export type MealShareContext = MealResolvers & {
  /** Header line, e.g. "🍲 beanies meal plan · Aug 18–24". */
  header: string;
};

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
    const cook = ctx.cook(m.cookMemberId)?.name;
    lines.push(`  ${ctx.slotLabel(m.slot)}: ${ctx.mealName(m)}${cook ? ` (${cook})` : ''}`);
  }
  return lines.join('\n');
}
