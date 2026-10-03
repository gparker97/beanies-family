/**
 * The account and asset delete cascades (audit C7) against the REAL inline doc backend: each is
 * ONE Automerge change, and the dependents it names are detached in that same change.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { installInlineBackend, recordMutations } from '../../worker/__tests__/inlineHarness';
import { mutate } from '../../worker/docClient';
import type { MutationOp } from '../../worker/protocol';
import { getById, list } from '../../projection';
import { deleteAccountCascade } from '../accountRepository';
import { deleteAssetCascade } from '../assetRepository';
import type { Account, Asset, RecurringItem } from '@/types/models';

const account = (id: string, extra: Partial<Account> = {}): Account => ({
  id,
  memberId: 'm',
  name: id,
  type: 'checking',
  currency: 'USD',
  balance: 100,
  isActive: true,
  includeInNetWorth: true,
  createdAt: 'x',
  updatedAt: 'x',
  ...extra,
});

const recurring = (id: string, extra: Partial<RecurringItem> = {}): RecurringItem => ({
  id,
  accountId: 'chk',
  type: 'expense',
  amount: 10,
  currency: 'USD',
  category: 'x',
  description: id,
  frequency: 'monthly',
  dayOfMonth: 1,
  startDate: '2024-01-01',
  isActive: true,
  createdAt: 'x',
  updatedAt: 'x',
  ...extra,
});

const house: Asset = {
  id: 'house',
  memberId: 'm',
  type: 'real_estate',
  name: 'House',
  purchaseValue: 1,
  currentValue: 1,
  currency: 'USD',
  includeInNetWorth: true,
  loan: {
    hasLoan: true,
    outstandingBalance: 1000,
    lender: 'Bank',
    payFromAccountId: 'chk',
    linkedRecurringItemId: 'house-pay',
  },
  createdAt: 'x',
  updatedAt: 'x',
};

/** Every op `mutate` sent since the seed: one `batch` means one Automerge change. */
let sent: MutationOp[];

beforeEach(async () => {
  await installInlineBackend();
  sent = [];
  await mutate({
    op: 'batch',
    ops: [
      { op: 'set', collection: 'accounts', id: 'chk', entity: account('chk') },
      {
        op: 'set',
        collection: 'accounts',
        id: 'car-loan',
        entity: account('car-loan', { type: 'loan', payFromAccountId: 'chk', monthlyPayment: 5 }),
      },
      {
        op: 'set',
        collection: 'accounts',
        id: 'house-loan',
        entity: account('house-loan', { type: 'loan', linkedAssetId: 'house' }),
      },
      { op: 'set', collection: 'assets', id: 'house', entity: house },
      { op: 'set', collection: 'recurringItems', id: 'netflix', entity: recurring('netflix') },
      {
        op: 'set',
        collection: 'recurringItems',
        id: 'house-pay',
        entity: recurring('house-pay', { loanId: 'house' }),
      },
      {
        op: 'set',
        collection: 'recurringItems',
        id: 'other',
        entity: recurring('other', { accountId: 'elsewhere' }),
      },
    ],
  });
  sent = recordMutations();
});

describe('deleteAccountCascade', () => {
  it('deletes the account, deactivates its items and clears every payFromAccountId in ONE change', async () => {
    const ok = await deleteAccountCascade('chk', {
      recurringItemIds: ['netflix', 'house-pay'],
      loanAccountIds: ['car-loan'],
      assets: [house],
    });
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.op).toBe('batch');

    expect(getById('accounts', 'chk')).toBeUndefined();
    expect((getById('recurringItems', 'netflix') as RecurringItem).isActive).toBe(false);
    expect((getById('recurringItems', 'house-pay') as RecurringItem).isActive).toBe(false);
    expect((getById('recurringItems', 'other') as RecurringItem).isActive).toBe(true);
    const carLoan = getById('accounts', 'car-loan') as Account;
    expect(carLoan).not.toHaveProperty('payFromAccountId');
    expect(carLoan.monthlyPayment).toBe(5);
    const asset = getById('assets', 'house') as Asset;
    expect(asset.loan).not.toHaveProperty('payFromAccountId');
    // The rest of the loan survives the per-key merge.
    expect(asset.loan).toMatchObject({
      hasLoan: true,
      outstandingBalance: 1000,
      lender: 'Bank',
      linkedRecurringItemId: 'house-pay',
    });
  });

  it('a dependent deleted meanwhile does not fail the account delete', async () => {
    await mutate({ op: 'delete', collection: 'recurringItems', id: 'netflix' });
    expect(
      await deleteAccountCascade('chk', {
        recurringItemIds: ['netflix'],
        loanAccountIds: [],
        assets: [],
      })
    ).toBe(true);
    expect(getById('accounts', 'chk')).toBeUndefined();
  });

  it('an account not in the projection is refused without a write', async () => {
    expect(
      await deleteAccountCascade('nope', { recurringItemIds: [], loanAccountIds: [], assets: [] })
    ).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe('deleteAssetCascade', () => {
  it('deletes the asset, its mirror account and its payment item in ONE change', async () => {
    expect(
      await deleteAssetCascade('house', { accountId: 'house-loan', recurringItemId: 'house-pay' })
    ).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.op).toBe('batch');
    expect(getById('assets', 'house')).toBeUndefined();
    expect(getById('accounts', 'house-loan')).toBeUndefined();
    expect(getById('recurringItems', 'house-pay')).toBeUndefined();
    expect(
      list('recurringItems')
        .map((r) => r.id)
        .sort()
    ).toEqual(['netflix', 'other']);
  });

  it('with no links, deletes only the asset', async () => {
    expect(await deleteAssetCascade('house', {})).toBe(true);
    expect(getById('assets', 'house')).toBeUndefined();
    expect(getById('accounts', 'house-loan')).toBeDefined();
  });

  it('an asset not in the projection is refused without a write', async () => {
    expect(await deleteAssetCascade('nope', {})).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
