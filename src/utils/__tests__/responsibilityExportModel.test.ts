/**
 * The fridge sheet's view-model: only the family's deck is printed (skipped and unsorted
 * cards never are), split parts carry their label beside the pill, a card nobody holds is
 * a write-in line, and pagination flows whole category blocks through three columns and
 * onto more pages without ever splitting one.
 */
import { describe, it, expect } from 'vitest';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import {
  buildExportBlocks,
  estimateBlockHeight,
  paginateExport,
  EXPORT_LAYOUT,
  type DeckExportResolvers,
  type ExportBlock,
} from '@/utils/responsibilityExportModel';

function card(over: Partial<ResolvedCard> & { id: string }): ResolvedCard {
  return {
    isCustom: false,
    category: 'home',
    emoji: '🃏',
    status: 'held',
    splitMode: 'single',
    parts: [{ key: 'main', holderId: 'greg' }],
    state: null,
    ...over,
  };
}

const MEMBERS: Record<string, { name: string; color: string; initial: string }> = {
  greg: { name: 'greg', color: '#3b82f6', initial: 'G' },
  sofia: { name: 'Sofia', color: '#ec4899', initial: 'S' },
  mia: { name: 'Mia', color: '#f59e0b', initial: 'M' },
};

const R: DeckExportResolvers = {
  category: (id) => ({ title: `cat:${id ?? 'other'}`, emoji: '🏠', color: '#E67E22' }),
  name: (c) => `name:${c.id}`,
  done: (c) => `done:${c.id}`,
  emoji: (c) => c.emoji,
  partLabel: (c, p) =>
    c.splitMode === 'child'
      ? (MEMBERS[p.key]?.name ?? '')
      : c.splitMode === 'label'
        ? (p.label ?? '')
        : '',
  member: (id) => (id ? MEMBERS[id] : undefined),
};

describe('buildExportBlocks', () => {
  it('prints held and waiting cards by category, never skipped or unsorted ones', () => {
    const model = buildExportBlocks(
      [
        card({ id: 'laundry' }),
        card({ id: 'lunchboxes', category: 'kids', parts: [{ key: 'main', holderId: 'sofia' }] }),
        card({ id: 'pool', category: 'projects', status: 'skipped' }),
        card({ id: 'dishes', status: 'unsorted', parts: [{ key: 'main' }] }),
        card({ id: 'fixing', status: 'waiting', parts: [{ key: 'main' }] }),
      ],
      R
    );
    expect(model.blocks.map((b) => b.key)).toEqual(['home', 'kids']);
    expect(model.blocks[0]!.cards.map((c) => c.id)).toEqual(['laundry', 'fixing']);
    expect(model.blocks.flatMap((b) => b.cards).some((c) => c.id === 'pool')).toBe(false);
  });

  it('draws a waiting card as a write-in line and says so for the legend', () => {
    const model = buildExportBlocks(
      [card({ id: 'fixing', status: 'waiting', parts: [{ key: 'main' }] })],
      R
    );
    expect(model.blocks[0]!.cards[0]).toMatchObject({ writeIn: true, holders: [] });
    expect(model.hasWriteIn).toBe(true);
  });

  it('puts each split part label beside its pill, with an open part as a labelled write-in', () => {
    const model = buildExportBlocks(
      [
        card({
          id: 'bedtime',
          category: 'kids',
          status: 'waiting',
          splitMode: 'child',
          parts: [{ key: 'mia', holderId: 'greg' }, { key: 'leo' }],
        }),
      ],
      { ...R, partLabel: (_c, p) => (p.key === 'mia' ? 'Mia' : 'Leo') }
    );
    const row = model.blocks[0]!.cards[0]!;
    expect(row.writeIn).toBe(false);
    expect(row.holders).toEqual([
      { initial: 'G', color: '#3b82f6', label: 'Mia' },
      { label: 'Leo' },
    ]);
  });

  it('lists each holder once in the legend, in first-appearance order', () => {
    const model = buildExportBlocks(
      [
        card({ id: 'a', parts: [{ key: 'main', holderId: 'sofia' }] }),
        card({ id: 'b', parts: [{ key: 'main', holderId: 'greg' }] }),
        card({ id: 'c', parts: [{ key: 'main', holderId: 'sofia' }] }),
      ],
      R
    );
    expect(model.people.map((p) => p.name)).toEqual(['Sofia', 'greg']);
    expect(model.hasWriteIn).toBe(false);
  });
});

describe('paginateExport', () => {
  function block(key: string, rows: number): ExportBlock {
    return {
      key,
      title: key,
      emoji: '🏠',
      color: '#E67E22',
      cards: Array.from({ length: rows }, (_, i) => ({
        id: `${key}-${i}`,
        emoji: '🃏',
        name: 'Short name',
        done: 'A short done line',
        holders: [],
        writeIn: false,
      })),
    };
  }

  it('keeps a small deck on one page in three columns', () => {
    const pages = paginateExport([block('home', 3), block('kids', 3)]);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.columns).toHaveLength(EXPORT_LAYOUT.columns);
  });

  const baseKey = (b: ExportBlock) => b.key.split('~')[0]!;
  const colHeight = (col: ExportBlock[]) =>
    col.reduce((sum, b, i) => sum + estimateBlockHeight(b) + (i ? EXPORT_LAYOUT.blockGap : 0), 0);

  it('continues a category too tall for its column into the next column of the same page', () => {
    // ~19 cards: taller than one column (the Home & Household case that shrank page 1).
    const pages = paginateExport([block('home', 19), block('out', 2)]);
    expect(pages).toHaveLength(1);
    const [c0, c1] = pages[0]!.columns;
    expect(c0!.map((b) => b.key)).toEqual(['home']);
    expect(c1![0]).toMatchObject({ key: 'home~1', continued: true });
    // Every card is placed once, in order, and no column passes the page's capacity.
    const homeCards = pages[0]!.columns
      .flat()
      .filter((b) => baseKey(b) === 'home')
      .flatMap((b) => b.cards);
    expect(homeCards.map((c) => c.id)).toEqual(block('home', 19).cards.map((c) => c.id));
    for (const col of pages[0]!.columns)
      expect(colHeight(col)).toBeLessThanOrEqual(EXPORT_LAYOUT.pageCapacity);
  });

  it('breaks pages only between categories, never inside one', () => {
    const blocks = Array.from({ length: 9 }, (_, i) => block(`cat${i}`, 12));
    const pages = paginateExport(blocks);
    expect(pages.length).toBeGreaterThan(1);
    // Each category lives on exactly one page, and categories stay in order.
    const pageOf = new Map<string, Set<number>>();
    pages.forEach((p, i) =>
      p.columns
        .flat()
        .forEach((b) => pageOf.set(baseKey(b), (pageOf.get(baseKey(b)) ?? new Set()).add(i)))
    );
    for (const set of pageOf.values()) expect(set.size).toBe(1);
    const order = pages.flatMap((p) => p.columns.flat().map(baseKey));
    expect([...new Set(order)]).toEqual(blocks.map((b) => b.key));
    for (const page of pages)
      for (const col of page.columns)
        expect(colHeight(col)).toBeLessThanOrEqual(EXPORT_LAYOUT.pageCapacity);
  });

  it('never strands a header at the foot of a column with fewer than two rows', () => {
    const pages = paginateExport([block('a', 13), block('b', 10)]);
    for (const b of pages.flatMap((p) => p.columns.flat()))
      expect(b.cards.length).toBeGreaterThanOrEqual(2);
  });

  it('spreads a category taller than a whole page over its columns, the last taking the rest', () => {
    const pages = paginateExport([block('huge', 60)]);
    expect(pages).toHaveLength(1);
    const cols = pages[0]!.columns;
    expect(cols.every((c) => c.length === 1)).toBe(true);
    expect(cols.flat().reduce((n, b) => n + b.cards.length, 0)).toBe(60);
    expect(colHeight(cols[0]!)).toBeLessThanOrEqual(EXPORT_LAYOUT.pageCapacity);
  });

  it('returns one empty page for an empty deck', () => {
    expect(paginateExport([])).toEqual([{ columns: [[], [], []] }]);
  });
});
