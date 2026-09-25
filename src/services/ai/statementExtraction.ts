// Statement reader (#107): turn a bank or card statement into per-unit reads and one merged
// result.
//
// A statement is not read like the other documents. It is read ONE PAGE (or one text chunk) per
// call, after an on-device classifier sets aside the pages that carry no transactions (terms,
// marketing, payment slips), because:
//   - every call is one bean, and BofA's 8-page statement has 1 transaction page;
//   - `MODEL_LIST_MAX` bounds lines per call, and SCB's statement has ~178 lines;
//   - the statement consent must state the read count BEFORE anything is sent.
// So the reader is two steps: `prepareStatementUnits` (no network, gives the count) and
// `readStatement` (the calls). A dropped page is rendered anyway, on the device, so "read it
// anyway" in the review is one more call on a prepared source rather than a re-open.
//
// LAYERING: this module knows the AI service and pdf.js. It never imports the ingest spine,
// its state, its text budget or any store. Progress leaves through a callback; the caller (the
// spine's statement branch, or the import store's "read it anyway") decides what to do with it.

import { logEvent } from '@/services/telemetry/logEvent';
import * as perfTiming from '@/utils/perfTiming';
import { boundText } from '@/utils/boundText';
import { EXTRACT_LONG_EDGE } from '@/utils/pdfExtractionImages';
import { MAX_SHARE_TEXT_CHARS } from '@/services/share/types';
import { STATEMENT_MAX_PAGES, readStatementPdf } from '@/utils/statement/statementPages';
import { MODEL_LIST_MAX } from './extractionPrompt';
import {
  extractStatementFromSource,
  prepareImageSource,
  type ExtractOptions,
} from './documentExtractionService';
import type {
  ExtractionErrorCode,
  ExtractionSource,
  StatementDroppedPage,
  StatementExtractionResult,
  StatementReadResult,
  StatementUnitOutcome,
} from './types';

const SURFACE = 'statement-import';

/** The most units (pages or text chunks) one statement read will send. */
export const STATEMENT_MAX_UNITS = STATEMENT_MAX_PAGES;

/**
 * The most body lines per text chunk. The character bound alone is not enough: a CSV export
 * has short lines, so 10 000 characters of one is ~160 rows, past `MODEL_LIST_MAX` (100), and
 * the parser cap would silently drop the tail. 60 leaves headroom for wrapped descriptions.
 */
export const STATEMENT_CHUNK_MAX_LINES = 60;

/**
 * Error codes that end the whole run. Each is about the READER (refused, unverifiable,
 * unavailable, throttled), not about the page, so trying the next page would fail the same way
 * and spend another bean finding out.
 */
const TERMINAL_CODES = new Set<ExtractionErrorCode>([
  'rate_limited',
  'not_available',
  'attestation_failed',
  'offline',
]);

/** What the statement reader can be given. */
export type StatementInput =
  | { kind: 'pdf'; file: File }
  /** One or more photos or screenshots: each is one unit (weekly screenshots come in several). */
  | { kind: 'image'; files: File[] }
  /** An already-prepared source (a correction's page images or text), re-sent as is. */
  | { kind: 'prepared'; source: ExtractionSource }
  | { kind: 'text'; text: string; source: 'csv' | 'text' };

/** One unit to send: a rendered page, a photo, or a text chunk. */
export interface StatementUnit {
  source: ExtractionSource;
  /** 1-based PDF page, when the unit is a page. */
  page?: number;
}

/** Everything known before any call is made. */
export interface PreparedStatement {
  units: StatementUnit[];
  droppedPages: StatementDroppedPage[];
  unitsBeyondCap: number;
  pageCount?: number;
  /** How many units are TEXT, for the caller's text budget. */
  textUnits: number;
  source: StatementReadResult['source'];
}

/** A read that produced at least one unit, or the code of the failure that ended it. */
export type StatementReadOutcome =
  | { ok: true; read: StatementReadResult }
  | { ok: false; errorCode: ExtractionErrorCode | undefined };

/**
 * Does this text look like a CSV export? Provenance only (it decides nothing about how the text
 * is read), so a heuristic is enough: the first two non-empty lines have the same comma count,
 * and it is at least two.
 */
export function looksLikeCsv(text: string): boolean {
  const [first, second] = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!first || !second) return false;
  const commas = (l: string) => (l.match(/,/g) ?? []).length;
  return commas(first) >= 2 && commas(first) === commas(second);
}

/**
 * Split statement text into chunks bounded by BOTH `MAX_SHARE_TEXT_CHARS` and
 * `STATEMENT_CHUNK_MAX_LINES`, cut at line boundaries. A CSV's header row is repeated at the top
 * of every chunk so each call can still read its columns. A single line longer than the
 * character bound is bounded with `boundText`, never a bare `slice` (which can split a
 * surrogate pair). Pure.
 */
export function chunkStatementText(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = looksLikeCsv(text) ? lines[0]! : null;
  const body = header ? lines.slice(1) : lines;
  const headerChars = header ? header.length + 1 : 0;
  const maxBodyChars = Math.max(1, MAX_SHARE_TEXT_CHARS - headerChars);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push([...(header ? [header] : []), ...current].join('\n'));
    current = [];
    currentChars = 0;
  };
  for (const raw of body) {
    const line = boundText(raw, maxBodyChars);
    const cost = line.length + 1;
    if (current.length >= STATEMENT_CHUNK_MAX_LINES || currentChars + cost > maxBodyChars) flush();
    current.push(line);
    currentChars += cost;
  }
  flush();
  // A header-only CSV (no body) still deserves one read, which will honestly say "no lines".
  if (chunks.length === 0 && header) chunks.push(header);
  return chunks;
}

/**
 * Fold several unit results into one. Lines keep their order; each identity field (account,
 * period, balances) is taken from the first unit that has it, since page 1 is where statements
 * print them. Confidence is the LOWEST unit's: one unreadable page is the thing to know. Pure,
 * and reused by "read it anyway" to fold one more unit in.
 */
export function mergeUnitResults(results: StatementExtractionResult[]): StatementExtractionResult {
  const first = <T>(pick: (r: StatementExtractionResult) => T | undefined): T | undefined => {
    for (const r of results) {
      const v = pick(r);
      if (v !== undefined && v !== '') return v;
    }
    return undefined;
  };
  const institution = first((r) => r.account.institution);
  const last4 = first((r) => r.account.last4);
  const currency = first((r) => r.account.currency);
  const kind = first((r) => r.account.kind);
  const from = first((r) => r.period.from);
  const to = first((r) => r.period.to);
  const opening = first((r) => r.balances.opening);
  const closing = first((r) => r.balances.closing);
  return {
    isStatement: results.some((r) => r.isStatement),
    account: {
      ...(institution ? { institution } : {}),
      ...(last4 ? { last4 } : {}),
      ...(currency ? { currency } : {}),
      ...(kind ? { kind } : {}),
    },
    period: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
    balances: {
      ...(opening !== undefined ? { opening } : {}),
      ...(closing !== undefined ? { closing } : {}),
    },
    lines: results.flatMap((r) => r.lines),
    confidence: results.length ? Math.min(...results.map((r) => r.confidence)) : 0,
  };
}

/** A rendered page as a `File`, which is what the shared compressor takes. */
function pageFile(blob: Blob, page: number): File {
  return new File([blob], `statement-page-${page}.jpg`, { type: blob.type || 'image/jpeg' });
}

/** Split a prepared source into one unit per page image, or chunk its text. */
function unitsFromPrepared(source: ExtractionSource): StatementUnit[] {
  if (source.kind === 'images') {
    return source.imageDataUrls.map((url, i) => ({
      source: { kind: 'images', imageDataUrls: [url] },
      page: i + 1,
    }));
  }
  return chunkStatementText(source.text).map((text) => ({ source: { kind: 'text', text } }));
}

/**
 * Work out every unit a statement read will send, with NO network: classify and render a PDF's
 * pages, compress a photo, or chunk text. The caller needs the count before consent (the sheet
 * states it) and before the text budget (which is consumed per chunk). Throws
 * `CompressionError` (from the renderer or compressor) for the caller's shared mapping.
 */
export async function prepareStatementUnits(input: StatementInput): Promise<PreparedStatement> {
  switch (input.kind) {
    case 'pdf': {
      const pdf = await readStatementPdf(input.file, {
        cap: STATEMENT_MAX_UNITS,
        longEdge: EXTRACT_LONG_EDGE,
      });
      const units: StatementUnit[] = [];
      const droppedPages: StatementDroppedPage[] = [];
      for (const verdict of pdf.pages) {
        const source = await prepareImageSource(pageFile(verdict.blob, verdict.page));
        if (verdict.kept) units.push({ source, page: verdict.page });
        else droppedPages.push({ page: verdict.page, source });
      }
      // The classifier found nothing to read. Rather than send nothing (and tell the family
      // their statement is empty), read every page: an over-read costs beans the consent sheet
      // has already stated; an under-read loses their transactions.
      const noneKept = units.length === 0 && droppedPages.length > 0;
      if (noneKept) {
        units.push(...droppedPages.map((d) => ({ source: d.source, page: d.page })));
        droppedPages.length = 0;
      }
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'pages_classified',
        context: {
          action: 'pages_classified',
          count: units.length,
          detail: [
            `dropped:${droppedPages.length}`,
            `beyond_cap:${Math.max(0, pdf.pageCount - STATEMENT_MAX_UNITS)}`,
            ...(pdf.hasTextLayer ? [] : ['no_text_layer']),
            ...(pdf.classifyFailed ? [`classify_failed:${pdf.classifyFailed}`] : []),
            ...(noneKept ? ['none_kept'] : []),
          ].join('|'),
        },
      });
      return {
        units,
        droppedPages,
        unitsBeyondCap: Math.max(0, pdf.pageCount - STATEMENT_MAX_UNITS),
        pageCount: pdf.pageCount,
        textUnits: 0,
        source: 'pdf',
      };
    }
    case 'image': {
      const read = input.files.slice(0, STATEMENT_MAX_UNITS);
      const units: StatementUnit[] = [];
      for (const file of read) units.push({ source: await prepareImageSource(file) });
      return {
        units,
        droppedPages: [],
        unitsBeyondCap: input.files.length - read.length,
        textUnits: 0,
        source: 'image',
      };
    }
    case 'prepared': {
      const all = unitsFromPrepared(input.source);
      const units = all.slice(0, STATEMENT_MAX_UNITS);
      return {
        units,
        droppedPages: [],
        unitsBeyondCap: all.length - units.length,
        textUnits: input.source.kind === 'text' ? units.length : 0,
        source: input.source.kind === 'text' ? 'text' : 'image',
      };
    }
    case 'text': {
      const chunks = chunkStatementText(input.text);
      const units = chunks.slice(0, STATEMENT_MAX_UNITS).map((text) => ({
        source: { kind: 'text' as const, text },
      }));
      return {
        units,
        droppedPages: [],
        unitsBeyondCap: chunks.length - units.length,
        textUnits: units.length,
        source: input.source,
      };
    }
  }
}

/**
 * Send every prepared unit, one call each, and merge what came back.
 *
 * A single unit's failure does not end the run (one unreadable page must not cost the family the
 * other four); a TERMINAL code does, and the units after it are recorded as failed with that
 * code rather than attempted. If NO unit was read, the caller gets the last code to report once
 * through the shared toast mapping.
 */
export async function readStatement(
  prepared: PreparedStatement,
  opts: ExtractOptions,
  onProgress: (progress: { done: number; total: number }) => void
): Promise<StatementReadOutcome> {
  const started = performance.now();
  const total = prepared.units.length;
  const results: StatementExtractionResult[] = [];
  const units: StatementUnitOutcome[] = [];
  let lastCode: ExtractionErrorCode | undefined;
  let stoppedBy: ExtractionErrorCode | undefined;

  for (let i = 0; i < total; i += 1) {
    const unit = prepared.units[i]!;
    const at = { unit: i, ...(unit.page ? { page: unit.page } : {}) };
    if (stoppedBy) {
      units.push({ ...at, status: 'failed', errorCode: stoppedBy });
      continue;
    }
    onProgress({ done: i, total });
    const result = await extractStatementFromSource(unit.source, opts);
    if (result.success && result.data) {
      results.push(result.data);
      units.push({
        ...at,
        status: result.data.lines.length >= MODEL_LIST_MAX ? 'capped' : 'read',
      });
      continue;
    }
    lastCode = result.errorCode;
    units.push({ ...at, status: 'failed', ...(lastCode ? { errorCode: lastCode } : {}) });
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'read_unit_failed',
      context: { action: 'read_unit_failed', error_code: lastCode, detail: `unit:${i}` },
    });
    if (lastCode && TERMINAL_CODES.has(lastCode)) stoppedBy = lastCode;
  }
  onProgress({ done: total, total });

  const failed = units.filter((u) => u.status === 'failed').length;
  const capped = units.filter((u) => u.status === 'capped').length;
  const result = mergeUnitResults(results);
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'read_complete',
    context: {
      action: 'read_complete',
      count: result.lines.length,
      detail: `units:${total}|failed:${failed}|capped:${capped}|source:${prepared.source}`,
    },
  });
  perfTiming.record('statement-import.read', performance.now() - started, {
    perf_entity_count: total,
  });

  if (results.length === 0) return { ok: false, errorCode: lastCode };
  return {
    ok: true,
    read: {
      result,
      units,
      droppedPages: prepared.droppedPages,
      unitsBeyondCap: prepared.unitsBeyondCap,
      ...(prepared.pageCount !== undefined ? { pageCount: prepared.pageCount } : {}),
      source: prepared.source,
    },
  };
}
