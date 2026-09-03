import type { MealPlanEntry, MealSlot } from '@/types/models';

/**
 * The resolver shape `buildMealExportRows` consumes: the View builds one object
 * (i18n-resolved labels + store lookups) so a meal is named, attributed, and
 * labelled identically across the grid and can never drift.
 *
 * Pure/injected — no store or i18n imports here, so the model stays testable.
 */
export interface MealResolvers {
  /** Short weekday + day-of-month for the GRID header, e.g. { weekday: 'Mon', dayNum: '17' }. */
  dayHeading: (dateISO: string) => { weekday: string; dayNum: string };
  /** Localized slot label, e.g. "Dinner". */
  slotLabel: (slot: MealSlot) => string;
  /** Display name for a meal — recipe name, or the type label (Eat out / …). */
  mealName: (meal: MealPlanEntry) => string;
  /** Cook display info, or undefined when unassigned. */
  /**
   * Cook display info, or undefined when unassigned.
   *
   * `initial` is supplied by the caller from the roster-wide collision map, NOT derived
   * here: the printed cell shows the chip alone, so on a mono printer the letter is the
   * ONLY carrier left once colour is gone — and two cooks whose names start the same would
   * otherwise be identical everywhere on the page, legend included.
   */
  cook: (memberId?: string) => { name: string; color?: string; initial?: string } | undefined;
}

/** One meal within a grid cell (a day+slot may hold several — multi-dish). */
export interface ExportMealCell {
  id: string;
  name: string;
  /** Non-recipe "type" meal (eat out / leftovers / skip / other) — rendered muted+italic. */
  isType: boolean;
  /** Resolved cook — `initial` is derived here so the renderer stays dumb. */
  cook?: {
    name: string;
    initial: string;
    color?: string;
  };
  /**
   * The cook's note, e.g. "Ben's friend is dairy-free, use the oat cream".
   *
   * Print is the only surface that shows it. The board card dropped its 📝 glyph for width
   * and no other view ever rendered `note`, so the one thing a parent writes down for the
   * other was reaching nobody. The fridge sheet is where it is actually read.
   */
  note?: string;
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

/**
 * Fallback only — the caller should pass a collision-aware initial.
 *
 * Kept for resolvers that supply none (tests, and the share-text path), where one letter is
 * better than none.
 */
function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '';
}

function toCell(meal: MealPlanEntry, resolvers: MealResolvers): ExportMealCell {
  const cook = resolvers.cook(meal.cookMemberId);
  return {
    id: meal.id,
    name: resolvers.mealName(meal),
    isType: meal.kind !== 'recipe',
    note: meal.note?.trim() || undefined,
    cook: cook
      ? { name: cook.name, initial: cook.initial || initialOf(cook.name), color: cook.color }
      : undefined,
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
          // The SAME initial the cells use. This built its own with `initialOf`, so the
          // legend printed "S" while the cells printed "SOF" for one person — and the
          // legend is the key that makes the cells decodable, so a mismatch defeats it
          // entirely. One derivation, used twice.
          initial: resolved.initial || initialOf(resolved.name),
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
