import { describe, it, expect } from 'vitest';
import { suggestTransfer, suggestTransfers } from '../transfers';
import { line, tx } from './fixtures';

const CARD = 'acc-card';
const cardPayment = line({
  kind: 'payment',
  direction: 'in',
  amount: 1200,
  date: '2026-03-20',
  description: 'PAYMENT THANK YOU',
});

describe('suggestTransfer', () => {
  it('finds an opposite-direction plain row in another account, equal amount, within 3 days', () => {
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-dbs',
      type: 'expense',
      amount: 1200,
      date: '2026-03-18',
    });
    expect(suggestTransfer(cardPayment, CARD, [paid])).toEqual({
      kind: 'counterpart',
      otherAccountId: 'acc-dbs',
      transactionId: 'dbs-1',
    });
  });

  it('ignores rows that are already transfers, same-direction rows, other amounts and far dates', () => {
    const rows = [
      tx({
        id: 'xfer',
        accountId: 'acc-dbs',
        type: 'transfer',
        toAccountId: CARD,
        amount: 1200,
        date: '2026-03-20',
      }),
      tx({
        id: 'same-dir',
        accountId: 'acc-dbs',
        type: 'income',
        amount: 1200,
        date: '2026-03-20',
      }),
      tx({
        id: 'amount',
        accountId: 'acc-dbs',
        type: 'expense',
        amount: 1200.5,
        date: '2026-03-20',
      }),
      tx({ id: 'far', accountId: 'acc-dbs', type: 'expense', amount: 1200, date: '2026-03-24' }),
      tx({ id: 'own', accountId: CARD, type: 'expense', amount: 1200, date: '2026-03-20' }),
    ];
    expect(suggestTransfer(cardPayment, CARD, rows)).toBeNull();
    expect(suggestTransfer(cardPayment, CARD, rows, { isCardAccount: true })).toEqual({
      kind: 'offer',
    });
  });

  it('only for kinds payment and transfer', () => {
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-dbs',
      type: 'expense',
      amount: 1200,
      date: '2026-03-20',
    });
    expect(
      suggestTransfer({ ...cardPayment, kind: 'refund' }, CARD, [paid], { isCardAccount: true })
    ).toBeNull();
  });

  it('an out line pairs with an income row elsewhere', () => {
    const received = tx({
      id: 'sav',
      accountId: 'acc-sav',
      type: 'income',
      amount: 500,
      date: '2026-03-05',
    });
    const l = line({ kind: 'transfer', direction: 'out', amount: 500, date: '2026-03-04' });
    expect(suggestTransfer(l, 'acc-bank', [received])).toMatchObject({ transactionId: 'sav' });
  });

  it('skips claimed rows', () => {
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-dbs',
      type: 'expense',
      amount: 1200,
      date: '2026-03-20',
    });
    expect(suggestTransfer(cardPayment, CARD, [paid], { claimed: new Set(['dbs-1']) })).toBeNull();
  });
});

describe('suggestTransfers', () => {
  it('claims each counterpart once, closest date first; the other line falls back to an offer', () => {
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-dbs',
      type: 'expense',
      amount: 1200,
      date: '2026-03-19',
    });
    const early = { ...cardPayment, date: '2026-03-17' };
    const exact = { ...cardPayment, date: '2026-03-19' };
    const out = suggestTransfers([early, exact], CARD, [paid], { isCardAccount: true });
    expect(out).toEqual([
      { kind: 'offer' },
      { kind: 'counterpart', otherAccountId: 'acc-dbs', transactionId: 'dbs-1' },
    ]);
  });

  it('null lines get null back', () => {
    expect(suggestTransfers([null], CARD, [], { isCardAccount: true })).toEqual([null]);
  });
});
