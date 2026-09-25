/**
 * The statement parsers (#107): the per-unit reply, the identity-only share reply, and the
 * last-4 control that holds even when the model ignores the prompt and returns a full number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

import {
  MODEL_LIST_MAX,
  parseShareExtractionResult,
  parseStatementExtractionResult,
  parseStatementIdentity,
} from '../extractionPrompt';

const goodLine = (over: Record<string, unknown> = {}) => ({
  date: '2026-03-10',
  description: 'NTUC FAIRPRICE #0423',
  amount: 23.4,
  direction: 'out',
  kind: 'purchase',
  ...over,
});

const reply = (over: Record<string, unknown> = {}) => ({
  isStatement: true,
  account: { institution: 'DBS', last4: '1234', currency: 'sgd', kind: 'bank' },
  period: { from: '2026-03-01', to: '2026-03-31' },
  balances: { opening: 100, closing: 50 },
  lines: [goodLine()],
  confidence: 0.8,
  ...over,
});

const droppedEvents = () =>
  logEventMock.mock.calls.filter((c) => c[0].message === 'model_lines_dropped');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseStatementExtractionResult', () => {
  it('parses a well-formed reply', () => {
    const out = parseStatementExtractionResult(reply());
    expect(out).toMatchObject({
      isStatement: true,
      account: { institution: 'DBS', last4: '1234', currency: 'SGD', kind: 'bank' },
      period: { from: '2026-03-01', to: '2026-03-31' },
      balances: { opening: 100, closing: 50 },
      confidence: 0.8,
    });
    expect(out.lines).toEqual([
      {
        date: '2026-03-10',
        description: 'NTUC FAIRPRICE #0423',
        amount: 23.4,
        direction: 'out',
        kind: 'purchase',
      },
    ]);
    expect(droppedEvents()).toHaveLength(0);
  });

  it('throws when a required key is missing', () => {
    expect(() => parseStatementExtractionResult({ lines: [] })).toThrow(/isStatement/);
    expect(() => parseStatementExtractionResult({ isStatement: true })).toThrow(/lines/);
    expect(() => parseStatementExtractionResult(null)).toThrow();
    expect(() => parseStatementExtractionResult('nope')).toThrow();
  });

  it('drops malformed lines and counts them in ONE model_lines_dropped event', () => {
    const out = parseStatementExtractionResult(
      reply({
        lines: [
          goodLine({ amount: 1 }),
          goodLine({ date: undefined }),
          goodLine({ date: 'not a date' }),
          goodLine({ direction: 'sideways' }),
          goodLine({ amount: 'abc' }),
          goodLine({ amount: null }),
          goodLine({ description: '', merchant: '' }),
          goodLine({ amount: 2 }),
        ],
      })
    );
    expect(out.lines.map((l) => l.amount)).toEqual([1, 2]);
    expect(droppedEvents()).toHaveLength(1);
    expect(droppedEvents()[0]![0]).toMatchObject({
      level: 'warn',
      surface: 'statement-import',
      context: { action: 'model_lines_dropped', count: 6 },
    });
  });

  // An empty-string amount means the model could not read the amount. `Number('')` is 0, so
  // without the guard in `asMoney` the line survived as a 0.00 transaction.
  it('drops a line whose amount is an empty string (not a 0.00 line)', () => {
    const out = parseStatementExtractionResult(reply({ lines: [goodLine({ amount: '' })] }));
    expect(out.lines).toEqual([]);
  });

  it('parses printed amounts and makes negatives positive', () => {
    const out = parseStatementExtractionResult(
      reply({
        lines: [
          goodLine({ amount: '1,613.00' }),
          goodLine({ amount: -42.5 }),
          goodLine({ amount: '-2,305.17' }),
          goodLine({ amount: ' 7.1 ' }),
        ],
        balances: { opening: '-1,000.50', closing: 'n/a' },
      })
    );
    expect(out.lines.map((l) => l.amount)).toEqual([1613, 42.5, 2305.17, 7.1]);
    expect(out.balances).toEqual({ opening: 1000.5 });
  });

  it('an unknown line kind becomes other', () => {
    const out = parseStatementExtractionResult(
      reply({ lines: [goodLine({ kind: 'cashback' }), goodLine({ kind: 'payment' })] })
    );
    expect(out.lines.map((l) => l.kind)).toEqual(['other', 'payment']);
  });

  it('keeps original only when both amount and ISO currency are valid', () => {
    const out = parseStatementExtractionResult(
      reply({
        lines: [
          goodLine({ original: { amount: '12.00', currency: 'usd' } }),
          goodLine({ original: { amount: 12, currency: 'dollars' } }),
          goodLine({ original: { amount: 'x', currency: 'USD' } }),
          goodLine({ original: { currency: 'USD' } }),
        ],
      })
    );
    expect(out.lines[0]!.original).toEqual({ amount: 12, currency: 'USD' });
    expect(out.lines.slice(1).every((l) => l.original === undefined)).toBe(true);
  });

  it('falls back to the merchant when the description is empty', () => {
    const out = parseStatementExtractionResult(
      reply({ lines: [goodLine({ description: '', merchant: 'FairPrice' })] })
    );
    expect(out.lines[0]).toMatchObject({ description: 'FairPrice', merchant: 'FairPrice' });
  });

  it('caps lines at MODEL_LIST_MAX', () => {
    const lines = Array.from({ length: MODEL_LIST_MAX + 25 }, (_, i) => goodLine({ amount: i }));
    const out = parseStatementExtractionResult(reply({ lines }));
    expect(out.lines).toHaveLength(MODEL_LIST_MAX);
    expect(out.lines[MODEL_LIST_MAX - 1]!.amount).toBe(MODEL_LIST_MAX - 1);
    // Lines past the cap are not "dropped as malformed".
    expect(droppedEvents()).toHaveLength(0);
  });

  it('a non-array lines value yields no lines', () => {
    expect(parseStatementExtractionResult(reply({ lines: 'none' })).lines).toEqual([]);
  });
});

describe('parseStatementIdentity', () => {
  it('keeps only the last 4 digits of a masked card number', () => {
    expect(
      parseStatementIdentity({ account: { last4: '4231-79XX-XXXX-9086' } }).account.last4
    ).toBe('9086');
  });

  it('keeps only the last 4 digits of a full 16-digit number', () => {
    expect(parseStatementIdentity({ account: { last4: '4231791234569086' } }).account.last4).toBe(
      '9086'
    );
    expect(
      parseStatementIdentity({ account: { last4: '4231 7912 3456 9086' } }).account.last4
    ).toBe('9086');
  });

  it('omits last4 when there are no digits, and an unknown account kind', () => {
    const out = parseStatementIdentity({ account: { last4: 'XXXX', kind: 'savings' } });
    expect(out.account).toEqual({});
  });

  it('drops invalid period dates and reports them to the collector', () => {
    const rejected: string[] = [];
    const out = parseStatementIdentity(
      { period: { from: '2026-02-30', to: '2026-03-31T00:00:00Z' } },
      rejected
    );
    expect(out.period).toEqual({ to: '2026-03-31' });
    expect(rejected).toEqual(['period.from']);
  });

  it('tolerates a missing or non-object payload', () => {
    expect(parseStatementIdentity(undefined)).toEqual({ account: {}, period: {} });
    expect(parseStatementIdentity({ account: [1, 2] })).toEqual({ account: {}, period: {} });
  });
});

describe('parseShareExtractionResult: transactions', () => {
  it('parses identity only, with no lines', () => {
    const out = parseShareExtractionResult({
      kind: 'transactions',
      transactions: {
        account: { institution: 'Standard Chartered', last4: '4231-79XX-XXXX-9086', kind: 'card' },
        period: { from: '2026-03-01', to: '2026-03-31' },
      },
    });
    expect(out).toEqual({
      kind: 'transactions',
      transactions: {
        account: { institution: 'Standard Chartered', last4: '9086', kind: 'card' },
        period: { from: '2026-03-01', to: '2026-03-31' },
      },
    });
    expect(out.kind === 'transactions' && 'lines' in out.transactions).toBe(false);
  });

  it('throws when the transactions object is missing', () => {
    expect(() => parseShareExtractionResult({ kind: 'transactions' })).toThrow(/transactions/);
  });
});
