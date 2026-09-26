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

  it('flows onto more pages without ever splitting a block', () => {
    const blocks = Array.from({ length: 9 }, (_, i) => block(`cat${i}`, 12));
    const pages = paginateExport(blocks);
    expect(pages.length).toBeGreaterThan(1);
    const placed = pages.flatMap((p) => p.columns.flat());
    // Every block appears exactly once, whole, and in order.
    expect(placed.map((b) => b.key)).toEqual(blocks.map((b) => b.key));
    for (const b of placed) expect(b.cards).toHaveLength(12);
    // No column is filled past the page's height: the capacity, or its tallest block.
    for (const page of pages) {
      const cap = Math.max(
        EXPORT_LAYOUT.pageCapacity,
        ...page.columns.flat().map((b) => estimateBlockHeight(b))
      );
      for (const col of page.columns) {
        const h = col.reduce(
          (sum, b, i) => sum + estimateBlockHeight(b) + (i ? EXPORT_LAYOUT.blockGap : 0),
          0
        );
        expect(h).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('never cuts an oversized block, and lets the other columns on its page fill to its height', () => {
    const pages = paginateExport([block('huge', 60), block('a', 20), block('b', 20)]);
    expect(pages).toHaveLength(1);
    const cols = pages[0]!.columns;
    expect(cols[0]!.map((b) => b.key)).toEqual(['huge']);
    expect(cols[1]!.map((b) => b.key)).toEqual(['a', 'b']);
  });

  it('returns one empty page for an empty deck', () => {
    expect(paginateExport([])).toEqual([{ columns: [[], [], []] }]);
  });
});
