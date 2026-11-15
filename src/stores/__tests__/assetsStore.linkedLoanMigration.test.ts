/**
 * The linked-loan migration is load maintenance (2026-11-15): `loadAssets` is read-only, and
 * the one-per-session migration runs after the stores were reloaded from the authoritative
 * document (assets AND accounts loaded). Against the REAL inline doc backend.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { mutate } from '@/services/automerge/worker/docClient';
import { list as projectionList } from '@/services/automerge/projection';
import {
  __resetLoadMaintenanceForTesting,
  __whenLoadMaintenanceIdleForTesting,
  runLoadMaintenance,
} from '@/services/automerge/loadMaintenance';
import { useAssetsStore } from '../assetsStore';
import { useAccountsStore } from '../accountsStore';
import type { Account, Asset } from '@/types/models';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const house: Asset = {
  id: 'house',
  memberId: 'm-1',
  type: 'real_estate',
  name: 'House',
  purchaseValue: 500000,
  currentValue: 600000,
  currency: 'USD',
  includeInNetWorth: true,
  loan: { hasLoan: true, loanAmount: 20000, outstandingBalance: 10000, lender: 'Bank' },
  createdAt: 'x',
  updatedAt: 'x',
};

const linked = () =>
  (projectionList('accounts') as Account[]).filter((a) => a.linkedAssetId === 'house');

async function maintain(): Promise<void> {
  runLoadMaintenance('reload');
  await __whenLoadMaintenanceIdleForTesting();
}

describe('linked-loan migration as load maintenance', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    __resetLoadMaintenanceForTesting();
    await installInlineBackend();
    useAssetsStore().resetState(); // a new session: the migration has not run yet
    await mutate({ op: 'set', collection: 'assets', id: 'house', entity: house });
    await useAccountsStore().loadAccounts();
    await useAssetsStore().loadAssets();
  });

  it('loadAssets creates no account', () => {
    expect(useAssetsStore().assets.map((a) => a.id)).toEqual(['house']);
    expect(linked()).toEqual([]);
  });

  it('the maintenance run creates the linked loan account, once per session', async () => {
    await maintain();
    expect(linked()).toHaveLength(1);
    expect(linked()[0]).toMatchObject({ type: 'loan', balance: 10000, name: 'House Loan' });
    await maintain();
    expect(linked()).toHaveLength(1);
  });
});
