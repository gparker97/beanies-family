/**
 * Who Owns What (#109) — the fridge sheet's view-model (Requirement 19, mockup section 12).
 *
 * Pure: no store, no i18n, no DOM. The page hands in a resolver object (translated labels
 * and the export member resolver), so a card is named and a holder is drawn identically
 * everywhere on the sheet, and the whole thing is unit-testable.
 *
 *  - `buildExportBlocks`: one block per category (in the deck's category order), each card
 *    with its emoji, name, done line and holder pills. A split part carries its label (the
 *    child's name, or the family's label) beside its pill; an open part is a write-in. A
 *    card nobody holds is drawn as a dashed write-in line. Skipped and unsorted cards are
 *    not printed (they are not in the family's deck).
 *  - `paginateExport`: blocks flow top-to-bottom through three columns, page after page, by
 *    ESTIMATED height. A category taller than the room left in its column continues into
 *    the next column of the SAME page under a "continued" header; a page break only ever
 *    falls between categories (greg, 26 + 29 Sep). An underestimate is safe:
 *    `pngBlobsToPdf` scales each page to fit and never clips.
 */
import type { ExportPerson } from '@/utils/mealExportModel';
import { groupByCategory, type ResolvedCard, type ResolvedPart } from '@/utils/responsibilityDeck';
import type { ListCategory } from '@/types/models';

export interface ExportHolderPill {
  /** Holder initial(s) and colour; absent for an open part (a write-in). */
  initial?: string;
  color?: string;
  /** A split part's label: the child's name or the family's label. */
  label?: string;
}

export interface ExportCardRow {
  id: string;
  emoji: string;
  name: string;
  done: string;
  holders: ExportHolderPill[];
  /** Nobody holds any part: printed as a dashed line to write a name on. */
  writeIn: boolean;
}

export interface ExportBlock {
  key: string;
  title: string;
  emoji: string;
  color: string;
  cards: ExportCardRow[];
  /** A later piece of a category that continued from the previous column. */
  continued?: boolean;
}

export interface ExportPage {
  /** Always `columns` long; a column may be empty on the last page. */
  columns: ExportBlock[][];
}

export interface DeckExportModel {
  blocks: ExportBlock[];
  /** Distinct holders in first-appearance order (the footer legend). */
  people: ExportPerson[];
  /** Any write-in on the sheet (the legend's "still to deal" key prints only then). */
  hasWriteIn: boolean;
}

export interface DeckExportResolvers {
  /** Category heading; `null` = a category this build doesn't know. */
  category: (id: ListCategory | null) => { title: string; emoji: string; color: string };
  name: (card: ResolvedCard) => string;
  done: (card: ResolvedCard) => string;
  emoji: (card: ResolvedCard) => string;
  /** A split part's label ("Mia", "upstairs"); '' for an unsplit card. */
  partLabel: (card: ResolvedCard, part: ResolvedPart) => string;
  member: (id?: string) => { name: string; color?: string; initial?: string } | undefined;
}

export function buildExportBlocks(
  cards: readonly ResolvedCard[],
  r: DeckExportResolvers
): DeckExportModel {
  const deck = cards.filter((c) => c.status === 'held' || c.status === 'waiting');
  const people: ExportPerson[] = [];
  const seen = new Set<string>();
  let hasWriteIn = false;

  const blocks = groupByCategory(deck).map(({ category, cards: group }) => {
    const head = r.category(category);
    return {
      key: category ?? '__other',
      title: head.title,
      emoji: head.emoji,
      color: head.color,
      cards: group.map((card): ExportCardRow => {
        const holders: ExportHolderPill[] = card.parts.map((part) => {
          const label = r.partLabel(card, part) || undefined;
          const m = r.member(part.holderId);
          if (!m) return { label };
          const initial = m.initial || m.name.charAt(0).toUpperCase();
          if (part.holderId && !seen.has(part.holderId)) {
            seen.add(part.holderId);
            people.push({ initial, name: m.name, color: m.color });
          }
          return { initial, color: m.color, label };
        });
        const writeIn = holders.every((h) => !h.initial);
        if (holders.some((h) => !h.initial)) hasWriteIn = true;
        return {
          id: card.id,
          emoji: r.emoji(card),
          name: r.name(card),
          done: r.done(card),
          holders: writeIn ? [] : holders,
          writeIn,
        };
      }),
    };
  });
  return { blocks, people, hasWriteIn };
}

// ── Pagination ─────────────────────────────────────────────────────────────────

/** Estimated pixel metrics of `ResponsibilityExportBody` (px-pinned print artifact). */
export const EXPORT_LAYOUT = {
  columns: 3,
  /** Body height available per page, below the header and above the footer. */
  pageCapacity: 620,
  blockHeader: 30,
  blockGap: 8,
  rowPadding: 12,
  nameLine: 16,
  doneLine: 13,
  nameCharsPerLine: 30,
  doneCharsPerLine: 44,
} as const;

export type ExportLayout = { -readonly [K in keyof typeof EXPORT_LAYOUT]: number };

function lines(text: string, perLine: number): number {
  return text ? Math.max(1, Math.ceil(text.length / perLine)) : 0;
}

function rowHeight(card: ExportCardRow, layout: ExportLayout): number {
  return (
    layout.rowPadding +
    lines(card.name, layout.nameCharsPerLine) * layout.nameLine +
    lines(card.done, layout.doneCharsPerLine) * layout.doneLine
  );
}

export function estimateBlockHeight(
  block: ExportBlock,
  layout: ExportLayout = EXPORT_LAYOUT
): number {
  return block.cards.reduce((h, card) => h + rowHeight(card, layout), layout.blockHeader);
}

/** Where a piece of a category lands: its column on the page, and the rows it carries. */
interface Placement {
  col: number;
  block: ExportBlock;
}

/**
 * Lay `block` out from column `col` (with `used` px already filled) across the rest of the
 * page, one piece per column, each piece under its own header. `null` when it does not fit
 * in the columns that are left. A piece always carries at least `MIN_PIECE_ROWS` rows (or
 * the whole remainder), so a header is never stranded at the foot of a column.
 */
const MIN_PIECE_ROWS = 2;
function packAcross(
  block: ExportBlock,
  col: number,
  used: number,
  layout: ExportLayout,
  /** Let the page's last column take whatever is left (a category taller than a page). */
  lastColumnUnbounded = false
): { placements: Placement[]; col: number; used: number } | null {
  const placements: Placement[] = [];
  let cards = block.cards;
  let piece = 0;
  while (cards.length) {
    if (col >= layout.columns) return null;
    const cap =
      lastColumnUnbounded && col === layout.columns - 1
        ? Number.POSITIVE_INFINITY
        : layout.pageCapacity;
    const gap = used ? layout.blockGap : 0;
    let h = gap + layout.blockHeader;
    let take = 0;
    while (take < cards.length && used + h + rowHeight(cards[take]!, layout) <= cap) {
      h += rowHeight(cards[take]!, layout);
      take += 1;
    }
    // Too few rows fit here (and this isn't the whole remainder): start in the next column.
    if (take < Math.min(MIN_PIECE_ROWS, cards.length)) {
      if (used) {
        col += 1;
        used = 0;
        continue;
      }
      take = Math.max(take, 1); // an empty column always takes something
    }
    placements.push({
      col,
      block: {
        ...block,
        key: piece ? `${block.key}~${piece}` : block.key,
        cards: cards.slice(0, take),
        ...(piece ? { continued: true } : {}),
      },
    });
    used += h;
    cards = cards.slice(take);
    piece += 1;
    if (cards.length) {
      col += 1;
      used = 0;
    }
  }
  return { placements, col, used };
}

/**
 * Flow blocks down column 1, then 2, then 3, then onto the next page. A block that fits the
 * room left in its column goes in whole; one that does not continues into the following
 * columns of the same page; one that cannot finish on this page starts a fresh page. Only a
 * category too tall for a whole page (three columns) is still left to overflow its last
 * column, and that page is scaled down to fit A4 rather than cut.
 */
export function paginateExport(
  blocks: readonly ExportBlock[],
  layout: ExportLayout = EXPORT_LAYOUT
): ExportPage[] {
  const pages: ExportPage[] = [];
  const newPage = (): ExportPage => {
    const page = { columns: Array.from({ length: layout.columns }, () => [] as ExportBlock[]) };
    pages.push(page);
    return page;
  };
  if (!blocks.length) return [newPage()];

  let page = newPage();
  let col = 0;
  let used = 0;
  const pageIsEmpty = () => page.columns.every((c) => !c.length);
  for (const block of blocks) {
    let packed = packAcross(block, col, used, layout);
    if (!packed && !pageIsEmpty()) {
      page = newPage();
      col = 0;
      used = 0;
      packed = packAcross(block, col, used, layout);
    }
    // Taller than a whole page: fill the columns in turn, the last one taking the rest. An
    // unbounded last column always fits, so this never comes back null.
    packed ??= packAcross(block, col, used, layout, true)!;
    for (const p of packed.placements) page.columns[p.col]!.push(p.block);
    col = packed.col;
    used = packed.used;
  }
  return pages;
}
