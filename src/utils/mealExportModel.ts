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
  /** Localized long day heading for the TEXT share, e.g. "Monday, 17 August 2026". */
  dayLabel: (dateISO: string) => string;
  /** Short weekday + day-of-month for the GRID header, e.g. { weekday: 'Mon', dayNum: '17' }. */
  dayHeading: (dateISO: string) => { weekday: string; dayNum: string };
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
  /** Non-recipe "type" meal (eat out / leftovers / skip / other) — rendered muted+italic. */
  isType: boolean;
  /** Resolved cook — `initial` is derived here so the renderer stays dumb. */
  cook?: { name: string; initial: string; color?: string };
  serveTime?: string;
  /** Non-member guest count (names aren't shown on the sheet — a "+N" chip is). */
  guestCount: number;
}

/** One slot row across the week: `cells[i]` is the meals for `dayColumns[i]`. */
export interface ExportSlotRow {
  slot: MealSlot;
  slotLabel: string;
  cells: ExportMealCell[][];
}

/** A distinct cook appearing in the week — drives the footer legend. */
export interface ExportCook {
  initial: string;
  name: string;
  color?: string;
}

/** The full grid view-model — pure data, no DOM, no store. */
export interface MealExportRows {
  dayColumns: { dateISO: string; weekday: string; dayNum: string }[];
  rows: ExportSlotRow[];
  /** Distinct cooks across the week, in first-appearance order (footer legend). */
  cooks: ExportCook[];
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
    isType: meal.kind !== 'recipe',
    cook: cook ? { name: cook.name, initial: initialOf(cook.name), color: cook.color } : undefined,
    serveTime: meal.serveTime,
    guestCount: meal.guestNames?.length ?? 0,
  };
}

/**
 * Turn a week's meals into the grid view-model (rows = slots, columns = days,
 * cells = the resolved meals for that day+slot) plus the distinct-cooks legend.
 * Pure — no DOM, no store. Meals are assumed pre-sorted by date → slot →
 * position (the store's `mealsForWeek` contract), so per-cell order matches the
 * board.
 */
export function buildMealExportRows(
  meals: MealPlanEntry[],
  weekDates: string[],
  resolvers: MealResolvers
): MealExportRows {
  // Index meals by `date|slot` once so each cell lookup is O(1).
  const byCell = new Map<string, MealPlanEntry[]>();
  // Distinct cooks in first-appearance order, deduped by member id.
  const cookIds = new Set<string>();
  const cooks: ExportCook[] = [];
  for (const meal of meals) {
    const key = `${meal.date}|${meal.slot}`;
    const bucket = byCell.get(key);
    if (bucket) bucket.push(meal);
    else byCell.set(key, [meal]);

    if (meal.cookMemberId && !cookIds.has(meal.cookMemberId)) {
      const resolved = resolvers.cook(meal.cookMemberId);
      if (resolved) {
        cookIds.add(meal.cookMemberId);
        cooks.push({
          initial: initialOf(resolved.name),
          name: resolved.name,
          color: resolved.color,
        });
      }
    }
  }

  const dayColumns = weekDates.map((dateISO) => ({ dateISO, ...resolvers.dayHeading(dateISO) }));

  const rows: ExportSlotRow[] = SLOT_ORDER.map((slot) => ({
    slot,
    slotLabel: resolvers.slotLabel(slot),
    cells: weekDates.map((date) =>
      (byCell.get(`${date}|${slot}`) ?? []).map((meal) => toCell(meal, resolvers))
    ),
  }));

  return { dayColumns, rows, cooks };
}
