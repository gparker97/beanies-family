import { describe, it, expect } from 'vitest';
import { buildMealExportRows, type MealResolvers } from '@/utils/mealExportModel';
import type { MealPlanEntry, MealSlot } from '@/types/models';

function meal(
  over: Partial<MealPlanEntry> & { id: string; date: string; slot: MealSlot }
): MealPlanEntry {
  return {
    position: 0,
    kind: 'recipe',
    cooked: false,
    createdAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
    ...over,
  } as MealPlanEntry;
}

// Deterministic resolvers — name from label, cook from a small map.
const cooks: Record<string, { name: string; color?: string }> = {
  u1: { name: 'Alice', color: '#F15D22' },
  u2: { name: 'ben', color: undefined },
};
const resolvers: MealResolvers = {
  dayLabel: (d) => `day:${d}`,
  slotLabel: (s) => `slot:${s}`,
  mealName: (m) => m.label ?? m.id,
  cook: (id) => (id ? cooks[id] : undefined),
};

const WEEK = ['2026-08-17', '2026-08-18'];

describe('buildMealExportRows', () => {
  it('builds one column per day and four slot rows in fixed order', () => {
    const rows = buildMealExportRows([], WEEK, resolvers);
    expect(rows.dayColumns).toEqual([
      { dateISO: '2026-08-17', label: 'day:2026-08-17' },
      { dateISO: '2026-08-18', label: 'day:2026-08-18' },
    ]);
    expect(rows.rows.map((r) => r.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(rows.rows[0].slotLabel).toBe('slot:breakfast');
    // Every cell is an empty array when there are no meals.
    for (const row of rows.rows) {
      expect(row.cells).toHaveLength(WEEK.length);
      expect(row.cells.every((c) => c.length === 0)).toBe(true);
    }
  });

  it('places a meal in the right day/slot cell with a resolved cook chip', () => {
    const rows = buildMealExportRows(
      [meal({ id: 'm1', date: '2026-08-18', slot: 'dinner', label: 'Tacos', cookMemberId: 'u1' })],
      WEEK,
      resolvers
    );
    const dinner = rows.rows.find((r) => r.slot === 'dinner')!;
    // day index 1 = 2026-08-18
    expect(dinner.cells[0]).toHaveLength(0);
    expect(dinner.cells[1]).toHaveLength(1);
    const cell = dinner.cells[1][0];
    expect(cell).toMatchObject({
      id: 'm1',
      name: 'Tacos',
      cook: { name: 'Alice', initial: 'A', color: '#F15D22' },
    });
  });

  it('stacks multiple dishes in one cell in input order (multi-dish)', () => {
    const rows = buildMealExportRows(
      [
        meal({ id: 'a', date: '2026-08-17', slot: 'lunch', label: 'Soup' }),
        meal({ id: 'b', date: '2026-08-17', slot: 'lunch', label: 'Salad' }),
      ],
      WEEK,
      resolvers
    );
    const lunch = rows.rows.find((r) => r.slot === 'lunch')!;
    expect(lunch.cells[0].map((c) => c.name)).toEqual(['Soup', 'Salad']);
  });

  it('derives the cook initial and passes serve time + non-empty guests through', () => {
    const rows = buildMealExportRows(
      [
        meal({
          id: 'm',
          date: '2026-08-17',
          slot: 'dinner',
          label: 'Roast',
          cookMemberId: 'u2',
          serveTime: '18:30',
          guestNames: ['Sam', 'Kim'],
        }),
      ],
      WEEK,
      resolvers
    );
    const cell = rows.rows.find((r) => r.slot === 'dinner')!.cells[0][0];
    expect(cell.cook).toEqual({ name: 'ben', initial: 'B', color: undefined });
    expect(cell.serveTime).toBe('18:30');
    expect(cell.guests).toEqual(['Sam', 'Kim']);
  });

  it('omits cook when unassigned and guests when the array is empty', () => {
    const rows = buildMealExportRows(
      [meal({ id: 'm', date: '2026-08-17', slot: 'breakfast', label: 'Cereal', guestNames: [] })],
      WEEK,
      resolvers
    );
    const cell = rows.rows.find((r) => r.slot === 'breakfast')!.cells[0][0];
    expect(cell.cook).toBeUndefined();
    expect(cell.guests).toBeUndefined();
  });
});
