// Statement PDF page classification + rendering (#107).
//
// A statement PDF often carries pages with no transactions (terms, rate tables, marketing).
// Each page sent to the model costs one read, so an on-device classifier drops those pages
// first. The PDF is loaded ONCE: the same pass classifies (text layer) and renders (image) every
// page up to the cap. Rendering is on-device and free; only kept pages are sent, and a dropped
// page's rendered image travels with the result so "read it anyway" needs no second parse.

import { loadPdfjs, renderPdfPageToBlob } from '@/utils/pdfRender';
import { CompressionError } from '@/services/photos/photoCompression';

/** The most statement pages rendered (and so ever sent) for one import. */
export const STATEMENT_MAX_PAGES = 12;

/** A page is kept when its score is at least this (and always when the PDF has no text layer). */
export const STATEMENT_PAGE_MIN_SCORE = 4;

/** How many text items either side of a date an amount may sit and still count as its row. */
export const STATEMENT_PAGE_ROW_WINDOW = 6;

/**
 * Date-like: `12 Mar`, `12-Mar-24`, `03/12`, `3/12/2024`. The plan's `\d{1,2}[ /-](\w{3}|\d{1,2})`,
 * tightened so an amount such as `12 345` or a phone number cannot pass for a date.
 */
const DATE_LIKE = /(?<!\d)\d{1,2}[ /-](?:[A-Za-z]{3,9}|\d{1,2})(?!\d)/;

/**
 * Amount-like: `1,234.56`, `45.00`, `-5,000.00`, `2305.17`. The plan's
 * `\d{1,3}(,\d{3})*\.\d{2}`, loosened to any digit/comma run so it also takes the ungrouped form
 * CSV-style exports print, and written without a nested quantifier (no catastrophic backtracking).
 */
const AMOUNT_LIKE = /(?<![\d.,])\d[\d,]*\.\d{2}(?!\d)/;

/**
 * Score a page's text items: the number of date-like items that have an amount-like item within
 * {@link STATEMENT_PAGE_ROW_WINDOW} items (the same item included). A transaction table scores
 * roughly its row count; a terms page scores near zero. Pure, so it tests without pdf.js.
 */
export function scoreStatementPage(items: readonly string[]): number {
  const isAmount = items.map((s) => AMOUNT_LIKE.test(s));
  let score = 0;
  items.forEach((s, i) => {
    if (!DATE_LIKE.test(s)) return;
    const lo = Math.max(0, i - STATEMENT_PAGE_ROW_WINDOW);
    const hi = Math.min(items.length - 1, i + STATEMENT_PAGE_ROW_WINDOW);
    for (let j = lo; j <= hi; j++) {
      if (isAmount[j]) {
        score++;
        return;
      }
    }
  });
  return score;
}

export interface PageVerdict {
  /** 1-based page number. */
  page: number;
  kept: boolean;
  /** Classifier score (0 when the page's text could not be read). */
  score: number;
  /** The page rendered to JPEG (long edge ~`longEdge`px). */
  blob: Blob;
}

export interface StatementPdfRead {
  /** One verdict per page up to the cap, in page order. */
  pages: PageVerdict[];
  /** At least one page yielded a non-whitespace text item. False ⇒ every page is kept. */
  hasTextLayer: boolean;
  /** The document's total page count (pages beyond the cap were neither rendered nor read). */
  pageCount: number;
  /** Pages whose `getTextContent` threw; each was kept (never drop what we could not read). */
  classifyFailed: number;
}

/**
 * Load a statement PDF once, classify and render every page up to `cap`. A per-page
 * `getTextContent` throw keeps that page and is counted in `classifyFailed`. A document that
 * cannot be opened at all throws {@link CompressionError}, so the shared failure mapping shows
 * the existing `compression` toast.
 */
export async function readStatementPdf(
  file: Blob,
  opts: { cap?: number; longEdge: number }
): Promise<StatementPdfRead> {
  const cap = opts.cap ?? STATEMENT_MAX_PAGES;
  const pdfjs = await loadPdfjs();
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  } catch (err) {
    console.error(
      '[statement-import] could not open the statement PDF: a corrupt or password-protected ' +
        'file causes this. Reported to the user as a compression error.',
      err
    );
    throw new CompressionError('Could not open the statement PDF', err);
  }

  try {
    const count = Math.min(doc.numPages, cap);
    const scored: { page: number; score: number | null; blob: Blob }[] = [];
    let hasTextLayer = false;
    let classifyFailed = 0;

    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      try {
        let score: number | null;
        try {
          const content = await page.getTextContent();
          const items = content.items.map((item) => ('str' in item ? item.str : ''));
          if (items.some((s) => s.trim())) hasTextLayer = true;
          score = scoreStatementPage(items);
        } catch (err) {
          classifyFailed++;
          score = null;
          console.warn(
            '[statement-import] could not read the text of page %d; keeping it rather than ' +
              'dropping a page we could not classify.',
            i,
            err
          );
        }
        scored.push({ page: i, score, blob: await renderPdfPageToBlob(page, opts.longEdge) });
      } finally {
        page.cleanup();
      }
    }

    const pages = scored.map(({ page, score, blob }): PageVerdict => ({
      page,
      kept: !hasTextLayer || score === null || score >= STATEMENT_PAGE_MIN_SCORE,
      score: score ?? 0,
      blob,
    }));
    return { pages, hasTextLayer, pageCount: doc.numPages, classifyFailed };
  } finally {
    void doc.destroy();
  }
}
