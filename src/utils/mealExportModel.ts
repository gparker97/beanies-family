import type { MealPlanEntry, MealSlot } from '@/types/models';

/**
 * The single resolver shape consumed by BOTH the text share
 * (`formatMealPlanShare`) and the grid export (`buildMealExportRows`), so a meal
 * is named, attributed, and labelled identically on every surface and can never
 * drift. The View builds ONE resolver object (i18n-resolved labels + store
 * lookups) and hands the same object to both.
 *
 * Pure/injected — no store or i18n imports here, so the model stays testable.
 */
export interface MealResolvers {
  /** Localized day heading for a date, e.g. "Mon — Aug 18". */
  dayLabel: (dateISO: string) => string;
  /** Localized slot label, e.g. "Dinner". */
  slotLabel: (slot: MealSlot) => string;
  /** Display name for a meal — recipe name, or the type label (Eat out / …). */
  mealName: (meal: MealPlanEntry) => string;
  /** Cook display info, or undefined when unassigned. */
  cook: (memberId?: string) => { name: string; color?: string } | undefined;
}

/** One meal within a grid cell (a day+slot may hold several — multi-dish). */
export interface ExportMealCell {
  id: string;
  name: string;
  /** Resolved cook — `initial` is derived here so the renderer stays dumb. */
  cook?: { name: string; initial: string; color?: string };
  serveTime?: string;
  guests?: string[];
}

/** One slot row across the week: `cells[i]` is the meals for `dayColumns[i]`. */
export interface ExportSlotRow {
  slot: MealSlot;
  slotLabel: string;
  cells: ExportMealCell[][];
}

/** The full grid view-model — pure data, no DOM, no store. */
export interface MealExportRows {
  dayColumns: { dateISO: string; label: string }[];
  rows: ExportSlotRow[];
}

/** Fixed slot order — the export always shows all four rows (empty cells dashed). */
const SLOT_ORDER: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** First grapheme of a name, uppercased, for the cook chip. Empty string if none. */
function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '';
}

function toCell(meal: MealPlanEntry, resolvers: MealResolvers): ExportMealCell {
  const cook = resolvers.cook(meal.cookMemberId);
  return {
    id: meal.id,
    name: resolvers.mealName(meal),
    cook: cook ? { name: cook.name, initial: initialOf(cook.name), color: cook.color } : undefined,
    serveTime: meal.serveTime,
    guests: meal.guestNames && meal.guestNames.length > 0 ? meal.guestNames : undefined,
  };
}

/**
 * Turn a week's meals into the grid view-model (rows = slots, columns = days,
 * cells = the resolved meals for that day+slot). Pure — no DOM, no store. Meals
 * are assumed pre-sorted by date → slot → position (the store's `mealsForWeek`
 * contract), so per-cell order matches the board.
 */
export function buildMealExportRows(
  meals: MealPlanEntry[],
  weekDates: string[],
  resolvers: MealResolvers
): MealExportRows {
  // Index meals by `date|slot` once so each cell lookup is O(1).
  const byCell = new Map<string, MealPlanEntry[]>();
  for (const meal of meals) {
    const key = `${meal.date}|${meal.slot}`;
    const bucket = byCell.get(key);
    if (bucket) bucket.push(meal);
    else byCell.set(key, [meal]);
  }

  const dayColumns = weekDates.map((dateISO) => ({ dateISO, label: resolvers.dayLabel(dateISO) }));

  const rows: ExportSlotRow[] = SLOT_ORDER.map((slot) => ({
    slot,
    slotLabel: resolvers.slotLabel(slot),
    cells: weekDates.map((date) =>
      (byCell.get(`${date}|${slot}`) ?? []).map((meal) => toCell(meal, resolvers))
    ),
  }));

  return { dayColumns, rows };
}
