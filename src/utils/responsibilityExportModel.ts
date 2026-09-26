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
 *    ESTIMATED height. A block is never split across a column or a page. An underestimate
 *    is safe: `pngBlobsToPdf` scales each page to fit and never clips.
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

export function estimateBlockHeight(
  block: ExportBlock,
  layout: ExportLayout = EXPORT_LAYOUT
): number {
  let h = layout.blockHeader;
  for (const card of block.cards) {
    h +=
      layout.rowPadding +
      lines(card.name, layout.nameCharsPerLine) * layout.nameLine +
      lines(card.done, layout.doneCharsPerLine) * layout.doneLine;
  }
  return h;
}

/**
 * Flow blocks down column 1, then 2, then 3, then onto the next page, never splitting a
 * block. A block taller than a whole column still gets one to itself (it is scaled down
 * with its page rather than cut), and then sets that page's column height.
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
  // A page holding a block taller than a column is scaled down to fit A4 anyway, so its
  // other columns may fill to that height instead of spilling onto a half-empty page.
  let pageCap: number = layout.pageCapacity;
  for (const block of blocks) {
    const h = estimateBlockHeight(block, layout);
    if (used && used + layout.blockGap + h > pageCap) {
      col += 1;
      used = 0;
      if (col >= layout.columns) {
        page = newPage();
        col = 0;
        pageCap = layout.pageCapacity;
      }
    }
    page.columns[col]!.push(block);
    used += (used ? layout.blockGap : 0) + h;
    pageCap = Math.max(pageCap, h);
  }
  return pages;
}
