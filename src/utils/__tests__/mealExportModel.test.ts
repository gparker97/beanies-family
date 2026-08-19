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
  dayHeading: (d) => ({ weekday: `wd:${d.slice(-2)}`, dayNum: d.slice(-2) }),
  slotLabel: (s) => `slot:${s}`,
  mealName: (m) => m.label ?? m.id,
  cook: (id) => (id ? cooks[id] : undefined),
};

const WEEK = ['2026-08-17', '2026-08-18'];

describe('buildMealExportRows', () => {
  it('builds one column per day (weekday + dayNum) and four slot rows in order', () => {
    const rows = buildMealExportRows([], WEEK, resolvers);
    expect(rows.dayColumns).toEqual([
      { dateISO: '2026-08-17', weekday: 'wd:17', dayNum: '17' },
      { dateISO: '2026-08-18', weekday: 'wd:18', dayNum: '18' },
    ]);
    expect(rows.rows.map((r) => r.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(rows.rows[0].slotLabel).toBe('slot:breakfast');
    expect(rows.cooks).toEqual([]);
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
    expect(dinner.cells[0]).toHaveLength(0);
    expect(dinner.cells[1]).toHaveLength(1);
    expect(dinner.cells[1][0]).toMatchObject({
      id: 'm1',
      name: 'Tacos',
      isType: false,
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

  it('flags non-recipe meals as type, and passes serve time + guest COUNT through', () => {
    const rows = buildMealExportRows(
      [
        meal({
          id: 'm',
          date: '2026-08-17',
          slot: 'dinner',
          kind: 'eat_out',
          label: 'Sushi bar',
          cookMemberId: 'u2',
          serveTime: '18:30',
          guestNames: ['Sam', 'Kim'],
        }),
      ],
      WEEK,
      resolvers
    );
    const cell = rows.rows.find((r) => r.slot === 'dinner')!.cells[0][0];
    expect(cell.isType).toBe(true);
    expect(cell.cook).toEqual({ name: 'ben', initial: 'B', color: undefined });
    expect(cell.serveTime).toBe('18:30');
    expect(cell.guestCount).toBe(2);
  });

  it('omits cook when unassigned and reports guestCount 0 for no guests', () => {
    const rows = buildMealExportRows(
      [meal({ id: 'm', date: '2026-08-17', slot: 'breakfast', label: 'Cereal' })],
      WEEK,
      resolvers
    );
    const cell = rows.rows.find((r) => r.slot === 'breakfast')!.cells[0][0];
    expect(cell.cook).toBeUndefined();
    expect(cell.guestCount).toBe(0);
  });

  it('collects distinct cooks across the week in first-appearance order', () => {
    const rows = buildMealExportRows(
      [
        meal({ id: '1', date: '2026-08-17', slot: 'breakfast', cookMemberId: 'u2' }),
        meal({ id: '2', date: '2026-08-17', slot: 'lunch', cookMemberId: 'u1' }),
        meal({ id: '3', date: '2026-08-18', slot: 'dinner', cookMemberId: 'u2' }), // dup
        meal({ id: '4', date: '2026-08-18', slot: 'snack' }), // no cook
      ],
      WEEK,
      resolvers
    );
    expect(rows.cooks).toEqual([
      { initial: 'B', name: 'ben', color: undefined },
      { initial: 'A', name: 'Alice', color: '#F15D22' },
    ]);
  });
});
