import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readStatementPdf, scoreStatementPage, STATEMENT_PAGE_MIN_SCORE } from '../statementPages';
import { CompressionError } from '@/services/photos/photoCompression';

afterEach(() => vi.restoreAllMocks());

// Synthetic text-item arrays shaped like pdf.js `getTextContent` output for the three
// statement layouts. No real statement data.

/** SCB-style card page: date, date, description, amount per row, one item each. */
function cardPage(rows: number): string[] {
  const items = [
    'STATEMENT OF ACCOUNT',
    'Transaction Date',
    'Posting Date',
    'Description',
    'Amount (SGD)',
  ];
  for (let i = 1; i <= rows; i++) {
    const d = String(i).padStart(2, '0');
    items.push(`${d} MAR`, `${d} MAR`, `MERCHANT ${i} SINGAPORE`, `${(i * 13.37).toFixed(2)}`);
  }
  return items;
}

/** BofA-style checking page: `03/12` dates and `-1,234.56` amounts. */
function checkingPage(rows: number): string[] {
  const items = ['Date', 'Description', 'Amount'];
  for (let i = 1; i <= rows; i++) {
    items.push(
      `03/${String(i).padStart(2, '0')}/26`,
      `ACH DEBIT REF ${4000 + i}`,
      `-1,${String(100 + i)}.45`
    );
  }
  return items;
}

/** A terms and conditions page: prose, a phone number, a rate, no transaction rows. */
const termsPage = [
  'IMPORTANT INFORMATION ABOUT YOUR ACCOUNT',
  'Interest is charged at 26.9% per annum on the outstanding balance.',
  'Please call 1800 747 7000 if you notice an unauthorised transaction.',
  'Section 3 of the terms applies from 1 January.',
  'The minimum payment is the greater of 3% or the amount stated.',
];

describe('scoreStatementPage', () => {
  it('a terms page scores below the threshold', () => {
    expect(scoreStatementPage(termsPage)).toBeLessThan(STATEMENT_PAGE_MIN_SCORE);
  });

  it('a transaction page with ~20 rows scores high', () => {
    expect(scoreStatementPage(cardPage(20))).toBeGreaterThanOrEqual(20);
    expect(scoreStatementPage(checkingPage(20))).toBeGreaterThanOrEqual(20);
  });

  it('a row joined into one text item counts once per date', () => {
    const joined = Array.from({ length: 6 }, (_, i) => `0${i + 1}/03 COFFEE ${i + 1}.50`);
    expect(scoreStatementPage(joined)).toBe(6);
  });

  it('a date with no amount nearby does not count', () => {
    const items = ['12 MAR', ...Array(10).fill('words'), '45.00'];
    expect(scoreStatementPage(items)).toBe(0);
  });

  it('an empty page scores 0', () => {
    expect(scoreStatementPage([])).toBe(0);
  });
});

// ── readStatementPdf, with pdf.js mocked (jsdom cannot run it) ─────────────────────────────

const pdfState = vi.hoisted(() => ({
  pages: [] as ({ items: string[] } | 'throw')[],
  openFails: false,
  cleaned: 0,
  destroyed: 0,
}));

vi.mock('@/utils/pdfRender', () => ({
  loadPdfjs: async () => ({
    getDocument: () => ({
      promise: pdfState.openFails
        ? Promise.reject(new Error('bad pdf'))
        : Promise.resolve({
            numPages: pdfState.pages.length,
            getPage: async (n: number) => ({
              getTextContent: async () => {
                const p = pdfState.pages[n - 1]!;
                if (p === 'throw') throw new Error('no text');
                return { items: p.items.map((str) => ({ str })) };
              },
              cleanup: () => {
                pdfState.cleaned++;
              },
            }),
            destroy: async () => {
              pdfState.destroyed++;
            },
          }),
    }),
  }),
  renderPdfPageToBlob: async () => new Blob(['jpeg']),
}));

describe('readStatementPdf', () => {
  const file = new Blob(['%PDF']);
  beforeEach(() => {
    pdfState.openFails = false;
    pdfState.cleaned = 0;
    pdfState.destroyed = 0;
  });

  it('keeps transaction pages, drops a terms page, renders every page up to the cap', async () => {
    pdfState.pages = [{ items: cardPage(20) }, { items: termsPage }, { items: cardPage(8) }];
    const read = await readStatementPdf(file, { cap: 2, longEdge: 1600 });
    expect(read.pageCount).toBe(3);
    expect(read.hasTextLayer).toBe(true);
    expect(read.pages.map((p) => [p.page, p.kept])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(read.pages.every((p) => p.blob instanceof Blob)).toBe(true);
    expect(pdfState.cleaned).toBe(2);
    expect(pdfState.destroyed).toBe(1);
  });

  it('keeps every page when there is no text layer', async () => {
    pdfState.pages = [{ items: [] }, { items: ['  '] }];
    const read = await readStatementPdf(file, { longEdge: 1600 });
    expect(read.hasTextLayer).toBe(false);
    expect(read.pages.every((p) => p.kept)).toBe(true);
  });

  it('a per-page getTextContent throw keeps that page and is counted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pdfState.pages = [{ items: termsPage }, 'throw'];
    const read = await readStatementPdf(file, { longEdge: 1600 });
    expect(read.classifyFailed).toBe(1);
    expect(read.pages.map((p) => p.kept)).toEqual([false, true]);
  });

  it('a document that cannot be opened throws CompressionError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    pdfState.openFails = true;
    await expect(readStatementPdf(file, { longEdge: 1600 })).rejects.toBeInstanceOf(
      CompressionError
    );
  });
});
