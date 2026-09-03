/**
 * The printed cook chip, after the name was removed from it.
 *
 * The sheet exists to be printed and pinned to a fridge, so the first thing that happens to
 * it is losing colour. Once the name went, the letter was the only carrier left — and a
 * naive first-grapheme initial makes two cooks whose names start alike indistinguishable in
 * every cell AND in the legend, with nothing to fall back on.
 */
import { describe, it, expect } from 'vitest';
import { buildMealExportRows } from '@/utils/mealExportModel';
import type { MealPlanEntry, MealSlot } from '@/types/models';

const DATES = ['2026-09-07'];

function meal(over: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: 'm1',
    date: '2026-09-07',
    slot: 'dinner' as MealSlot,
    kind: 'recipe',
    recipeId: 'r1',
    cooked: false,
    position: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as MealPlanEntry;
}

function resolvers(
  cookFn: (id?: string) => { name: string; color?: string; initial?: string } | undefined
) {
  return {
    dayHeading: () => ({ weekday: 'Mon', dayNum: '7' }),
    slotLabel: (s: MealSlot) => s,
    mealName: () => 'Spaghetti',
    cook: cookFn,
  };
}

function firstCell(meals: MealPlanEntry[], cookFn: Parameters<typeof resolvers>[0]) {
  const model = buildMealExportRows(meals, DATES, resolvers(cookFn));
  return model.rows.find((r) => r.slot === 'dinner')!.cells.flat()[0]!;
}

describe('printed cook chip', () => {
  it('uses the caller-supplied collision-aware initial, not the first letter', () => {
    const cell = firstCell([meal({ cookMemberId: 'a' })], () => ({
      name: 'Mia',
      // What `familyStore.initialsById` produces when Mia and Max share an M.
      initial: 'Mi',
      color: '#ec4899',
    }));
    expect(cell.cook?.initial).toBe('Mi');
  });

  it('falls back to the first letter when no initial is supplied', () => {
    const cell = firstCell([meal({ cookMemberId: 'a' })], () => ({ name: 'Greg' }));
    expect(cell.cook?.initial).toBe('G');
  });

  /**
   * The whole point. Two cooks sharing a first letter must differ on the LETTER, because
   * the colour they also differ on does not survive a mono printer.
   */
  it('keeps two same-initial cooks distinguishable without colour', () => {
    const mia = firstCell([meal({ id: 'm1', cookMemberId: 'a' })], () => ({
      name: 'Mia',
      initial: 'Mi',
    }));
    const max = firstCell([meal({ id: 'm2', cookMemberId: 'b' })], () => ({
      name: 'Max',
      initial: 'Ma',
    }));
    expect(mia.cook?.initial).not.toBe(max.cook?.initial);
  });

  /**
   * The legend is the KEY that makes a nameless cell chip decodable, so if it derives its
   * own initial the two disagree and the key stops working — which is exactly what shipped:
   * cells printed "SOF" while the legend printed "S" for the same person.
   */
  it('gives the legend the same initial as the cells', () => {
    const model = buildMealExportRows(
      [meal({ cookMemberId: 'a' })],
      DATES,
      resolvers(() => ({ name: 'Sofia', initial: 'SOF', color: '#8b5cf6' }))
    );
    const cell = model.rows.find((r) => r.slot === 'dinner')!.cells.flat()[0]!;
    expect(model.cooks).toHaveLength(1);
    expect(model.cooks[0]!.initial).toBe('SOF');
    expect(model.cooks[0]!.initial).toBe(cell.cook!.initial);
  });

  /**
   * The footer key must describe what is ON the sheet. It used to print
   * "⏰ serve time · 👥 guests" on every export, so a plan using neither still carried a
   * key for two symbols that appeared nowhere — which reads as "these are missing".
   */
  it('reports serve time and guests only when the sheet actually has them', () => {
    const none = buildMealExportRows(
      [meal({})],
      DATES,
      resolvers(() => undefined)
    );
    expect(none.hasServeTime).toBe(false);
    expect(none.hasGuests).toBe(false);

    const timed = buildMealExportRows(
      [meal({ serveTime: '18:30' })],
      DATES,
      resolvers(() => undefined)
    );
    expect(timed.hasServeTime).toBe(true);
    expect(timed.hasGuests).toBe(false);

    const withGuests = buildMealExportRows(
      [meal({ guestNames: ['Ben'] })],
      DATES,
      resolvers(() => undefined)
    );
    expect(withGuests.hasGuests).toBe(true);
    expect(withGuests.hasServeTime).toBe(false);
  });

  it('carries the note, which no other surface renders', () => {
    const cell = firstCell([meal({ note: '  use the oat cream  ' })], () => undefined);
    expect(cell.note).toBe('use the oat cream');
  });

  it('omits a blank note rather than printing an empty line', () => {
    expect(firstCell([meal({ note: '   ' })], () => undefined).note).toBeUndefined();
    expect(firstCell([meal({})], () => undefined).note).toBeUndefined();
  });
});
