/**
 * The statement reader (#107): the pure chunker and merger, the no-network unit preparation,
 * and the per-unit read loop (a unit failure continues, a terminal code stops, all-failed
 * returns the code once).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prepareImageSourceMock, extractStatementMock, readStatementPdfMock, logEventMock } =
  vi.hoisted(() => ({
    prepareImageSourceMock: vi.fn(),
    extractStatementMock: vi.fn(),
    readStatementPdfMock: vi.fn(),
    logEventMock: vi.fn(),
  }));

vi.mock('../documentExtractionService', () => ({
  prepareImageSource: prepareImageSourceMock,
  extractStatementFromSource: extractStatementMock,
}));
vi.mock('@/utils/statement/statementPages', () => ({
  // The reader derives STATEMENT_MAX_UNITS from this, so the mock must export it.
  STATEMENT_MAX_PAGES: 12,
  readStatementPdf: readStatementPdfMock,
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));

import {
  STATEMENT_CHUNK_MAX_LINES,
  STATEMENT_MAX_UNITS,
  chunkStatementText,
  looksLikeCsv,
  mergeUnitResults,
  prepareStatementUnits,
  readStatement,
  type PreparedStatement,
} from '../statementExtraction';
import { MODEL_LIST_MAX } from '../extractionPrompt';
import { MAX_SHARE_TEXT_CHARS } from '@/services/share/types';
import type { ExtractionSource, StatementExtractionResult, StatementLineDraft } from '../types';
import type { ExtractOptions } from '../documentExtractionService';

const HEADER = 'Date,Description,Amount';
const csvRow = (i: number) => `2026-03-${String((i % 28) + 1).padStart(2, '0')},SHOP ${i},${i}.00`;
const csv = (rows: number) =>
  [HEADER, ...Array.from({ length: rows }, (_, i) => csvRow(i))].join('\n');

function lineOf(n: number): StatementLineDraft {
  return {
    date: '2026-03-10',
    description: `LINE ${n}`,
    amount: n,
    direction: 'out',
    kind: 'purchase',
  };
}

function result(over: Partial<StatementExtractionResult> = {}): StatementExtractionResult {
  return {
    isStatement: true,
    account: {},
    period: {},
    balances: {},
    lines: [],
    confidence: 0.9,
    ...over,
  };
}

const textUnit = (text: string) => ({ source: { kind: 'text' as const, text } });

function prepared(n: number): PreparedStatement {
  return {
    units: Array.from({ length: n }, (_, i) => ({
      source: { kind: 'images', imageDataUrls: [`data:image/jpeg;base64,p${i + 1}`] },
      page: i + 1,
    })),
    droppedPages: [],
    unitsBeyondCap: 0,
    pageCount: n,
    textUnits: 0,
    source: 'pdf',
  };
}

const OPTS = {} as ExtractOptions;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('looksLikeCsv', () => {
  it('recognises a CSV export with a header row', () => {
    expect(looksLikeCsv(`${HEADER}\n${csvRow(1)}\n${csvRow(2)}`)).toBe(true);
  });

  it('rejects prose, even prose with the odd comma', () => {
    expect(
      looksLikeCsv('Dear customer, here is your statement.\nThank you for banking with us.')
    ).toBe(false);
  });

  it('rejects a single line and empty input', () => {
    expect(looksLikeCsv(HEADER)).toBe(false);
    expect(looksLikeCsv('')).toBe(false);
  });
});

describe('chunkStatementText', () => {
  it('splits a 160-row CSV by the LINE bound, repeating the header and losing no row', () => {
    const chunks = chunkStatementText(csv(160));
    // Short lines: the character bound alone would put all 160 rows in one chunk.
    expect(csv(160).length).toBeLessThan(MAX_SHARE_TEXT_CHARS);
    expect(chunks.length).toBe(Math.ceil(160 / STATEMENT_CHUNK_MAX_LINES));

    const bodies: string[] = [];
    for (const chunk of chunks) {
      const [head, ...rows] = chunk.split('\n');
      expect(head).toBe(HEADER);
      expect(rows.length).toBeLessThanOrEqual(STATEMENT_CHUNK_MAX_LINES);
      expect(rows.length).toBeGreaterThan(0);
      bodies.push(...rows);
    }
    expect(bodies).toEqual(Array.from({ length: 160 }, (_, i) => csvRow(i)));
  });

  it('bounds a long-line text by MAX_SHARE_TEXT_CHARS per chunk', () => {
    const long = Array.from({ length: 12 }, (_, i) => `${i} ${'x'.repeat(3000)}`).join('\n');
    const chunks = chunkStatementText(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_SHARE_TEXT_CHARS);
    // No line lost: the 12 lines are all still there, in order.
    expect(
      chunks
        .join('\n')
        .split('\n')
        .map((l) => l.split(' ')[0])
    ).toEqual(Array.from({ length: 12 }, (_, i) => String(i)));
  });

  it('bounds a single line longer than the character cap', () => {
    const chunks = chunkStatementText('y'.repeat(MAX_SHARE_TEXT_CHARS * 2));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.length).toBeLessThanOrEqual(MAX_SHARE_TEXT_CHARS);
  });

  it('drops blank and whitespace-only lines', () => {
    expect(chunkStatementText('first line\n\n   \nsecond line\r\n\r\nthird')).toEqual([
      'first line\nsecond line\nthird',
    ]);
  });

  it('returns [] for empty or blank input', () => {
    expect(chunkStatementText('')).toEqual([]);
    expect(chunkStatementText('\n  \n')).toEqual([]);
  });

  it('a header-only CSV still yields one chunk', () => {
    // Two identical header lines make it look like CSV with no body rows beyond the first.
    expect(chunkStatementText(`${HEADER}\n${HEADER}`)).toEqual([`${HEADER}\n${HEADER}`]);
    // A lone header row does not look like CSV (one line); it is still one prose chunk.
    expect(chunkStatementText(HEADER)).toEqual([HEADER]);
  });
});

describe('mergeUnitResults', () => {
  it('keeps line order across units', () => {
    const merged = mergeUnitResults([
      result({ lines: [lineOf(1), lineOf(2)] }),
      result({ lines: [] }),
      result({ lines: [lineOf(3)] }),
    ]);
    expect(merged.lines.map((l) => l.amount)).toEqual([1, 2, 3]);
  });

  it('takes each identity field from the first unit that has it, independently', () => {
    const merged = mergeUnitResults([
      result({ account: { last4: '0042' }, period: { to: '2026-03-31' }, balances: {} }),
      result({
        account: { last4: '1111', institution: 'SCB', currency: 'SGD', kind: 'card' },
        period: { from: '2026-03-01', to: '2026-04-30' },
        balances: { opening: 0, closing: 50 },
      }),
      result({
        account: { institution: 'Other' },
        balances: { opening: 99, closing: 99 },
      }),
    ]);
    expect(merged.account).toEqual({
      last4: '0042',
      institution: 'SCB',
      currency: 'SGD',
      kind: 'card',
    });
    expect(merged.period).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    // An opening balance of 0 is a real value, not an absent one.
    expect(merged.balances).toEqual({ opening: 0, closing: 50 });
  });

  it('confidence is the lowest unit, isStatement is any unit', () => {
    const merged = mergeUnitResults([
      result({ confidence: 0.9, isStatement: false }),
      result({ confidence: 0.4, isStatement: true }),
      result({ confidence: 0.7, isStatement: false }),
    ]);
    expect(merged.confidence).toBe(0.4);
    expect(merged.isStatement).toBe(true);
    expect(mergeUnitResults([result({ isStatement: false })]).isStatement).toBe(false);
  });

  it('an empty list merges to an empty, zero-confidence result', () => {
    expect(mergeUnitResults([])).toMatchObject({ isStatement: false, lines: [], confidence: 0 });
  });
});

describe('prepareStatementUnits: text', () => {
  it('one unit per chunk, all counted as text units', async () => {
    const out = await prepareStatementUnits({ kind: 'text', text: csv(160), source: 'csv' });
    expect(out.units).toHaveLength(3);
    expect(out.units.every((u) => u.source.kind === 'text')).toBe(true);
    expect(out.textUnits).toBe(3);
    expect(out.unitsBeyondCap).toBe(0);
    expect(out.source).toBe('csv');
    expect(out.droppedPages).toEqual([]);
    expect(extractStatementMock).not.toHaveBeenCalled();
  });

  it('counts chunks past STATEMENT_MAX_UNITS as beyond the cap, never as units', async () => {
    const rows = STATEMENT_CHUNK_MAX_LINES * (STATEMENT_MAX_UNITS + 2);
    const out = await prepareStatementUnits({ kind: 'text', text: csv(rows), source: 'text' });
    expect(out.units).toHaveLength(STATEMENT_MAX_UNITS);
    expect(out.textUnits).toBe(STATEMENT_MAX_UNITS);
    expect(out.unitsBeyondCap).toBe(2);
  });
});

describe('prepareStatementUnits: prepared', () => {
  it('reads every shared screenshot as its own unit, capped (#107 review)', async () => {
    const files = Array.from(
      { length: 14 },
      (_, n) => new File(['x'], `shot-${n}.jpg`, { type: 'image/jpeg' })
    );
    const out = await prepareStatementUnits({ kind: 'image', files });
    expect(out.units).toHaveLength(12);
    expect(out.unitsBeyondCap).toBe(2);
    expect(out.source).toBe('image');
  });

  it('images become one unit per data URL, with page numbers', async () => {
    const source: ExtractionSource = {
      kind: 'images',
      imageDataUrls: ['data:a', 'data:b', 'data:c'],
    };
    const out = await prepareStatementUnits({ kind: 'prepared', source });
    expect(out.units).toEqual([
      { source: { kind: 'images', imageDataUrls: ['data:a'] }, page: 1 },
      { source: { kind: 'images', imageDataUrls: ['data:b'] }, page: 2 },
      { source: { kind: 'images', imageDataUrls: ['data:c'] }, page: 3 },
    ]);
    expect(out.textUnits).toBe(0);
    expect(out.source).toBe('image');
  });

  it('text is chunked', async () => {
    const out = await prepareStatementUnits({
      kind: 'prepared',
      source: { kind: 'text', text: csv(160) },
    });
    expect(out.units).toHaveLength(3);
    expect(out.textUnits).toBe(3);
    expect(out.source).toBe('text');
    expect(out.units[0]!.page).toBeUndefined();
  });
});

describe('prepareStatementUnits: pdf', () => {
  const blob = () => new Blob(['jpeg'], { type: 'image/jpeg' });
  const file = new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    prepareImageSourceMock.mockImplementation(async (f: File) => ({
      kind: 'images',
      imageDataUrls: [`data:${f.name}`],
    }));
  });

  it('kept pages become units, dropped pages keep their prepared source', async () => {
    readStatementPdfMock.mockResolvedValue({
      pages: [
        { page: 1, kept: true, score: 5, blob: blob() },
        { page: 2, kept: false, score: 0, blob: blob() },
        { page: 3, kept: true, score: 4, blob: blob() },
      ],
      hasTextLayer: true,
      pageCount: 3,
      classifyFailed: 0,
    });
    const out = await prepareStatementUnits({ kind: 'pdf', file });

    expect(out.units.map((u) => u.page)).toEqual([1, 3]);
    expect(out.units[0]!.source).toEqual({
      kind: 'images',
      imageDataUrls: ['data:statement-page-1.jpg'],
    });
    expect(out.droppedPages).toEqual([
      { page: 2, source: { kind: 'images', imageDataUrls: ['data:statement-page-2.jpg'] } },
    ]);
    expect(out).toMatchObject({ pageCount: 3, unitsBeyondCap: 0, textUnits: 0, source: 'pdf' });
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'pages_classified',
        context: expect.objectContaining({
          action: 'pages_classified',
          count: 2,
          detail: 'dropped:1|beyond_cap:0',
        }),
      })
    );
    expect(extractStatementMock).not.toHaveBeenCalled();
  });

  it('zero kept pages promotes every page to a unit', async () => {
    readStatementPdfMock.mockResolvedValue({
      pages: [
        { page: 1, kept: false, score: 0, blob: blob() },
        { page: 2, kept: false, score: 0, blob: blob() },
      ],
      hasTextLayer: true,
      pageCount: 2,
      classifyFailed: 0,
    });
    const out = await prepareStatementUnits({ kind: 'pdf', file });
    expect(out.units.map((u) => u.page)).toEqual([1, 2]);
    expect(out.droppedPages).toEqual([]);
    const ctx = logEventMock.mock.calls.find((c) => c[0].message === 'pages_classified')![0]
      .context;
    expect(ctx.count).toBe(2);
    expect(ctx.detail).toContain('none_kept');
  });

  it('reports pages beyond the cap', async () => {
    readStatementPdfMock.mockResolvedValue({
      pages: [{ page: 1, kept: true, score: 5, blob: blob() }],
      hasTextLayer: false,
      pageCount: STATEMENT_MAX_UNITS + 3,
      classifyFailed: 1,
    });
    const out = await prepareStatementUnits({ kind: 'pdf', file });
    expect(out.unitsBeyondCap).toBe(3);
    const ctx = logEventMock.mock.calls.find((c) => c[0].message === 'pages_classified')![0]
      .context;
    expect(ctx.detail).toBe('dropped:0|beyond_cap:3|no_text_layer|classify_failed:1');
  });
});

describe('readStatement', () => {
  it('all units succeed: merged lines in order, read/capped statuses', async () => {
    const full = Array.from({ length: MODEL_LIST_MAX }, (_, i) => lineOf(100 + i));
    extractStatementMock
      .mockResolvedValueOnce({ success: true, data: result({ lines: [lineOf(1), lineOf(2)] }) })
      .mockResolvedValueOnce({ success: true, data: result({ lines: full }) });
    const onProgress = vi.fn();

    const out = await readStatement(prepared(2), OPTS, onProgress);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.read.result.lines).toHaveLength(2 + MODEL_LIST_MAX);
    expect(out.read.result.lines[0]!.amount).toBe(1);
    expect(out.read.units).toEqual([
      { unit: 0, page: 1, status: 'read' },
      { unit: 1, page: 2, status: 'capped' },
    ]);
    expect(out.read).toMatchObject({ pageCount: 2, source: 'pdf', unitsBeyondCap: 0 });
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  it('a unit that fails with provider_error does not end the run', async () => {
    extractStatementMock
      .mockResolvedValueOnce({ success: true, data: result({ lines: [lineOf(1)] }) })
      .mockResolvedValueOnce({ success: false, errorCode: 'provider_error' })
      .mockResolvedValueOnce({ success: true, data: result({ lines: [lineOf(3)] }) });

    const out = await readStatement(prepared(3), OPTS, vi.fn());

    expect(extractStatementMock).toHaveBeenCalledTimes(3);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.read.units[1]).toEqual({
      unit: 1,
      page: 2,
      status: 'failed',
      errorCode: 'provider_error',
    });
    expect(out.read.result.lines.map((l) => l.amount)).toEqual([1, 3]);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'read_unit_failed',
        context: expect.objectContaining({ error_code: 'provider_error', detail: 'unit:1' }),
      })
    );
  });

  it('a terminal code stops the run: later units are failed without a call', async () => {
    extractStatementMock
      .mockResolvedValueOnce({ success: true, data: result({ lines: [lineOf(1)] }) })
      .mockResolvedValueOnce({ success: false, errorCode: 'rate_limited' });

    const out = await readStatement(prepared(4), OPTS, vi.fn());

    expect(extractStatementMock).toHaveBeenCalledTimes(2);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.read.units.map((u) => [u.status, u.errorCode])).toEqual([
      ['read', undefined],
      ['failed', 'rate_limited'],
      ['failed', 'rate_limited'],
      ['failed', 'rate_limited'],
    ]);
  });

  it('every unit failing returns ok:false with the code', async () => {
    extractStatementMock.mockResolvedValue({ success: false, errorCode: 'malformed_output' });
    const out = await readStatement(prepared(2), OPTS, vi.fn());
    expect(out).toEqual({ ok: false, errorCode: 'malformed_output' });
  });

  it('a text read carries no page numbers', async () => {
    extractStatementMock.mockResolvedValue({ success: true, data: result({ lines: [] }) });
    const out = await readStatement(
      {
        units: [textUnit('a'), textUnit('b')],
        droppedPages: [],
        unitsBeyondCap: 0,
        textUnits: 2,
        source: 'text',
      },
      OPTS,
      vi.fn()
    );
    expect(out.ok && out.read.units).toEqual([
      { unit: 0, status: 'read' },
      { unit: 1, status: 'read' },
    ]);
    expect(out.ok && 'pageCount' in out.read).toBe(false);
  });
});
