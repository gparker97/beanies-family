import { describe, it, expect } from 'vitest';
import {
  FAMILIAR_THRESHOLD,
  MATCH_WEIGHTS as W,
  matchLines,
  scoreCandidate,
  type MatchLine,
} from '../match';
import { line, projection, tx } from './fixtures';

const ACC = 'acc-bank';
const period = { from: '2026-03-01', to: '2026-03-31' };

/** A line whose description shares no word with the candidates, to isolate other signals. */
const plain = (over: Partial<MatchLine> = {}): MatchLine => ({
  ...line({ description: 'ZZZ UNRELATED' }),
  ...over,
});

describe('matchLines: the acceptance example', () => {
  const mortgage = projection({
    id: 'projected-rec-mortgage-2026-03-01',
    recurringItemId: 'rec-mortgage',
    description: 'Mortgage',
    amount: 2000,
    date: '2026-03-01',
    category: 'debt_payment',
  });
  const homeLoan = line({
    description: 'HOME LOAN',
    amount: 2305.17,
    date: '2026-03-14',
  });

  it('Mortgage 2,000 recurring on the 1st vs HOME LOAN 2,305.17 on the 14th is familiar', () => {
    const [m] = matchLines([{ ...homeLoan, category: 'debt_payment' }], [mortgage], period, ACC);
    expect(m).not.toBeNull();
    expect(m!.score).toBeCloseTo(W.amountLoose + W.dateSameMonth + W.category);
    expect(m!.score).toBeGreaterThanOrEqual(FAMILIAR_THRESHOLD);
    expect(m).toMatchObject({
      id: mortgage.id,
      isProjected: true,
      recurringItemId: 'rec-mortgage',
      dueDate: '2026-03-01',
    });
  });

  it('needs the category signal: the descriptions share no word', () => {
    const [m] = matchLines([homeLoan], [mortgage], period, ACC);
    expect(m).toBeNull();
  });
});

describe('scoreCandidate: the weight table', () => {
  it('exact amount + same date', () => {
    const c = tx({ id: 'a', amount: 42.5, date: '2026-03-10' });
    expect(scoreCandidate(plain({ amount: 42.5 }), c, ACC)).toBeCloseTo(
      W.amountEqual + W.dateEqual
    );
  });

  it('amount within 2%, or 1 unit capped at 25% of the amount', () => {
    const at = (amount: number) => tx({ id: 'a', amount, date: '2026-03-10' });
    expect(scoreCandidate(plain({ amount: 101.5 }), at(100), ACC)).toBeCloseTo(
      W.amountClose + W.dateEqual
    );
    // 1 unit on 30 is 3.3%: under the 5% cap, so close.
    expect(scoreCandidate(plain({ amount: 30.9 }), at(30), ACC)).toBeCloseTo(
      W.amountClose + W.dateEqual
    );
    // 0.30 on 5.30 (a typed 5.00 lunch vs the canteen's 5.30) is still close.
    expect(scoreCandidate(plain({ amount: 5.3 }), at(5), ACC)).toBeCloseTo(
      W.amountClose + W.dateEqual
    );
    // Small amounts: 0.16 and 0.99 are not close.
    expect(scoreCandidate(plain({ amount: 0.99 }), at(0.16), ACC)).toBe(0);
  });

  it('amount within 25% only for a recurring-linked or projected candidate', () => {
    const plainRow = tx({ id: 'a', amount: 100, date: '2026-03-10' });
    const recurringRow = tx({ id: 'b', amount: 100, date: '2026-03-10', recurringItemId: 'r' });
    expect(scoreCandidate(plain({ amount: 120 }), plainRow, ACC)).toBe(0);
    expect(scoreCandidate(plain({ amount: 120 }), recurringRow, ACC)).toBeCloseTo(
      W.amountLoose + W.dateEqual
    );
  });

  it('date windows: 3 days, 10 days, same month for recurring only', () => {
    const at = (date: string, over = {}) => tx({ id: date, amount: 10, date, ...over });
    expect(scoreCandidate(plain(), at('2026-03-13'), ACC)).toBeCloseTo(W.amountEqual + W.dateNear);
    expect(scoreCandidate(plain(), at('2026-03-20'), ACC)).toBeCloseTo(W.amountEqual + W.dateWide);
    expect(scoreCandidate(plain(), at('2026-03-28'), ACC)).toBeCloseTo(W.amountEqual);
    expect(scoreCandidate(plain(), at('2026-03-28', { recurringItemId: 'r' }), ACC)).toBeCloseTo(
      W.amountEqual + W.dateSameMonth
    );
  });

  it('description similarity scales up to its weight', () => {
    const c = tx({ id: 'a', amount: 10, date: '2026-03-28', description: 'Starbucks' });
    expect(scoreCandidate(plain({ description: 'STARBUCKS #0423' }), c, ACC)).toBeCloseTo(
      W.amountEqual + W.description
    );
  });

  it('no amount signal means no score at all', () => {
    const c = tx({
      id: 'a',
      amount: 500,
      date: '2026-03-10',
      description: 'Shop',
      category: 'groceries',
    });
    expect(scoreCandidate(plain({ description: 'SHOP', category: 'groceries' }), c, ACC)).toBe(0);
  });
});

describe('matchLines: eligibility and assignment', () => {
  it('greedy: one candidate per line and one line per candidate, best score first', () => {
    const c = tx({ id: 'only', amount: 50, date: '2026-03-10' });
    const far = plain({ amount: 50, date: '2026-03-12' });
    const same = plain({ amount: 50, date: '2026-03-10' });
    const out = matchLines([far, same], [c], period, ACC);
    expect(out[0]).toBeNull();
    expect(out[1]?.id).toBe('only');
  });

  it('two lines, two candidates: each line gets its own', () => {
    const a = tx({ id: 'a', amount: 50, date: '2026-03-10' });
    const b = tx({ id: 'b', amount: 50, date: '2026-03-12' });
    const out = matchLines(
      [plain({ amount: 50, date: '2026-03-12' }), plain({ amount: 50, date: '2026-03-10' })],
      [a, b],
      period,
      ACC
    );
    expect(out.map((m) => m?.id)).toEqual(['b', 'a']);
  });

  it('direction mismatch never matches', () => {
    const income = tx({ id: 'a', type: 'income', amount: 10, date: '2026-03-10' });
    expect(matchLines([plain({ direction: 'out' })], [income], period, ACC)).toEqual([null]);
  });

  it('a projection can match across a month boundary, like a real row (#107 review)', () => {
    // A charge on 2 Apr for an instance due 31 Mar. The merge records `recurringDueDate`, which
    // every dedupe site reads, so no month restriction is needed to keep it from doubling.
    const l = plain({ amount: 80, date: '2026-04-02' });
    const p = projection({ id: 'p', amount: 80, date: '2026-03-31', recurringItemId: 'r' });
    const real = tx({ id: 'real', amount: 80, date: '2026-03-31', recurringItemId: 'r' });
    const wide = { from: '2026-03-01', to: '2026-04-30' };
    expect(matchLines([l], [p], wide, ACC)[0]?.id).toBe('p');
    expect(matchLines([l], [real], wide, ACC)[0]?.id).toBe('real');
  });

  it('excludes other accounts, balance adjustments and rows outside the window', () => {
    const l = plain({ amount: 10, date: '2026-03-10' });
    const rows = [
      tx({ id: 'other', accountId: 'acc-other', amount: 10, date: '2026-03-10' }),
      tx({ id: 'adj', type: 'balance_adjustment', amount: 10, date: '2026-03-10' }),
    ];
    expect(matchLines([l], rows, period, ACC)).toEqual([null]);
    // Window is the period padded by periodPadDays: a row beyond it is never offered.
    const late = plain({ amount: 10, date: '2026-03-31' });
    const beyond = tx({ id: 'late', amount: 10, date: '2026-04-25' });
    expect(matchLines([late], [beyond], period, ACC)).toEqual([null]);
  });

  it('transfers: out of the account is `out`, into it is `in` (credit side amount)', () => {
    const outOf = tx({
      id: 't-out',
      type: 'transfer',
      accountId: ACC,
      toAccountId: 'acc-card',
      amount: 300,
      date: '2026-03-10',
    });
    const into = tx({
      id: 't-in',
      type: 'transfer',
      accountId: 'acc-usd',
      toAccountId: ACC,
      amount: 100,
      toAmount: 135,
      date: '2026-03-10',
    });
    expect(
      matchLines([plain({ amount: 300, direction: 'out' })], [outOf, into], period, ACC)[0]?.id
    ).toBe('t-out');
    expect(
      matchLines([plain({ amount: 135, direction: 'in' })], [outOf, into], period, ACC)[0]?.id
    ).toBe('t-in');
  });
});

describe('matchLines: possible duplicates (#107 follow-up)', () => {
  // greg's case: two interest credits in August, almost the same amount, 15 days apart.
  const aug = { from: '2026-08-01', to: '2026-08-31' };
  const interestLine = line({
    description: 'INTEREST CREDIT',
    amount: 12.41,
    direction: 'in',
    date: '2026-08-31',
  });
  const interestRow = tx({
    id: 'int',
    type: 'income',
    category: 'interest',
    description: 'Interest',
    amount: 12.38,
    date: '2026-08-16',
  });

  it('a near-duplicate below the familiar bar is a possible match', () => {
    const [m] = matchLines([interestLine], [interestRow], aug, ACC);
    expect(m).toMatchObject({ id: 'int', strength: 'possible', existingImported: false });
    expect(m!.score).toBeLessThan(FAMILIAR_THRESHOLD);
  });

  it('same month alone is enough alongside a close amount', () => {
    const [m] = matchLines(
      [{ ...interestLine, description: 'ZZZ' }],
      [{ ...interestRow, category: 'salary' }],
      aug,
      ACC
    );
    expect(m?.strength).toBe('possible');
  });

  it('a row from an earlier import is only ever a possible match, even when exact', () => {
    const imported = tx({ id: 'fp', amount: 10, date: '2026-03-10', importFingerprint: 'x' });
    const [m] = matchLines([plain({ amount: 10, date: '2026-03-10' })], [imported], period, ACC);
    expect(m).toMatchObject({ id: 'fp', strength: 'possible', existingImported: true });
  });

  it("greg's case: 0.16 on the statement vs 0.20 entered by hand, 28 days apart", () => {
    const row = tx({
      id: 'chase-int',
      type: 'income',
      category: 'interest',
      description: 'Chase Interest Payment',
      amount: 0.2,
      date: '2026-08-03',
    });
    const l = line({
      description: 'INTEREST PAYMENT',
      amount: 0.16,
      direction: 'in',
      date: '2026-08-31',
    });
    expect(matchLines([l], [row], aug, ACC)[0]).toMatchObject({
      id: 'chase-int',
      strength: 'possible',
    });
  });

  it('a loose amount needs clearly similar descriptions; a close one needs only one more thing', () => {
    const loose = { ...interestRow, amount: 11, category: 'salary' };
    // 11 vs 12.41 is loose (11%): "Interest" vs "INTEREST CREDIT" is similar enough (0.5).
    expect(matchLines([interestLine], [loose], aug, ACC)[0]?.strength).toBe('possible');
    // ...but not against an unrelated description, even in the same month.
    const unrelated = { ...loose, description: 'Dividend' };
    expect(matchLines([interestLine], [unrelated], aug, ACC)).toEqual([null]);
    // Beyond 25% is never possible.
    const far = { ...interestRow, amount: 9 };
    expect(matchLines([interestLine], [far], aug, ACC)).toEqual([null]);
  });

  it('at most possibleDays apart', () => {
    const tooFar = { ...interestRow, date: '2026-07-20' };
    expect(matchLines([interestLine], [tooFar], aug, ACC)).toEqual([null]);
  });

  it("a row from an earlier import only when that import's period overlaps this one", () => {
    const earlier = (from: string, to: string) =>
      tx({
        ...interestRow,
        id: 'imp',
        importFingerprint: 'x',
        importPeriod: { from, to },
      });
    // Last month's statement: a bank lists each transaction once, so never a duplicate.
    expect(matchLines([interestLine], [earlier('2026-07-01', '2026-07-31')], aug, ACC)).toEqual([
      null,
    ]);
    // An overlapping one (a mid-month screenshot, then the full statement) can be.
    expect(
      matchLines([interestLine], [earlier('2026-08-10', '2026-08-20')], aug, ACC)[0]?.strength
    ).toBe('possible');
  });

  it('nothing in common beyond the amount across months is not a possible match', () => {
    const l = plain({ amount: 50, date: '2026-04-02' });
    const row = tx({ id: 'x', amount: 50, date: '2026-03-20', category: 'other' });
    expect(matchLines([l], [row], { from: '2026-03-15', to: '2026-04-15' }, ACC)).toEqual([null]);
  });

  it('never claims a row a familiar match took', () => {
    const row = tx({ id: 'only', amount: 50, date: '2026-03-10' });
    const out = matchLines(
      [plain({ amount: 50, date: '2026-03-10' }), plain({ amount: 50, date: '2026-03-20' })],
      [row],
      period,
      ACC
    );
    expect(out[0]).toMatchObject({ id: 'only', strength: 'familiar' });
    expect(out[1]).toBeNull();
  });
});

describe('matchLines: review fixes (#107 follow-up)', () => {
  it("a familiar match needs the dates to agree: last month's same bill is only possible", () => {
    // 84.20 utilities on 28 Aug vs the statement's 84.20 on 26 Sep: amount + category = 0.80,
    // but a default MERGE would move August's bill to September.
    const row = tx({ id: 'aug', amount: 84.2, category: 'utilities', date: '2026-08-28' });
    const l = { ...plain({ amount: 84.2, date: '2026-09-26' }), category: 'utilities' };
    const [m] = matchLines([l], [row], { from: '2026-09-01', to: '2026-09-30' }, ACC);
    expect(m).toMatchObject({ id: 'aug', strength: 'possible', possibleRule: 'close' });
    expect(m!.strong).toBeUndefined();
  });

  it('an exact line on a row from an overlapping earlier import is a STRONG possible match', () => {
    const imported = tx({
      id: 'shot',
      amount: 10,
      date: '2026-03-10',
      importFingerprint: 'screenshot-line',
      importPeriod: { from: '2026-03-01', to: '2026-03-15' },
    });
    const [m] = matchLines([plain({ amount: 10, date: '2026-03-10' })], [imported], period, ACC);
    expect(m).toMatchObject({ strength: 'possible', existingImported: true, strong: true });
  });

  it('rule (b) is tagged as similar: a looser amount, clearly similar descriptions', () => {
    // 10.00 vs 12.00 is 17% apart (beyond close), within 25%, and the words match.
    const row = tx({
      id: 'i',
      type: 'income',
      description: 'Interest earned',
      amount: 10,
      date: '2026-08-03',
    });
    const l = line({
      description: 'INTEREST EARNED',
      amount: 12,
      direction: 'in',
      date: '2026-08-31',
    });
    expect(
      matchLines([l], [row], { from: '2026-08-01', to: '2026-08-31' }, ACC)[0]?.possibleRule
    ).toBe('similar');
  });

  it('non-Latin descriptions compare by word too', () => {
    const row = tx({ id: 'zh', description: '星巴克咖啡', amount: 20, date: '2026-03-05' });
    const l = line({ description: '星巴克咖啡', amount: 24, date: '2026-03-20' });
    expect(matchLines([l], [row], period, ACC)[0]).toMatchObject({
      id: 'zh',
      possibleRule: 'similar',
    });
  });
});
