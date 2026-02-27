import { describe, it, expect } from 'vitest';
import { mergeRecords, mergeSettings, mergeTombstones, mergeData } from '../mergeService';
import type { DeletionTombstone, Settings } from '@/types/models';
import type { ExportedData } from '@/services/indexeddb/database';

// Helper to create a timestamped record
function record(id: string, updatedAt: string, extra: Record<string, unknown> = {}) {
  return { id, updatedAt, ...extra } as { id: string; updatedAt: string; [key: string]: unknown };
}

function tombstone(id: string, entityType: string, deletedAt: string): DeletionTombstone {
  return { id, entityType: entityType as DeletionTombstone['entityType'], deletedAt };
}

describe('mergeRecords', () => {
  it('keeps records unique to each side', () => {
    const local = [record('a', '2026-01-01T00:00:00Z')];
    const file = [record('b', '2026-01-01T00:00:00Z')];
    const result = mergeRecords(local, file, new Map());
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the newer record when both sides have the same ID', () => {
    const local = [record('a', '2026-01-01T00:00:00Z', { name: 'old' })];
    const file = [record('a', '2026-01-02T00:00:00Z', { name: 'new' })];
    const result = mergeRecords(local, file, new Map());
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('new');
  });

  it('keeps local when timestamps are equal', () => {
    const local = [record('a', '2026-01-01T00:00:00Z', { source: 'local' })];
    const file = [record('a', '2026-01-01T00:00:00Z', { source: 'file' })];
    const result = mergeRecords(local, file, new Map());
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('local');
  });

  it('removes records with a newer tombstone', () => {
    const local = [record('a', '2026-01-01T00:00:00Z')];
    const file = [record('a', '2026-01-01T00:00:00Z')];
    const tsMap = new Map([['a', tombstone('a', 'todo', '2026-01-02T00:00:00Z')]]);
    const result = mergeRecords(local, file, tsMap);
    expect(result).toHaveLength(0);
  });

  it('keeps record if re-created after tombstone', () => {
    const local = [record('a', '2026-01-03T00:00:00Z')];
    const file: ReturnType<typeof record>[] = [];
    const tsMap = new Map([['a', tombstone('a', 'todo', '2026-01-02T00:00:00Z')]]);
    const result = mergeRecords(local, file, tsMap);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('a');
  });

  it('handles empty arrays', () => {
    expect(mergeRecords([], [], new Map())).toEqual([]);
  });

  it('preserves records not mentioned in tombstones', () => {
    const local = [record('a', '2026-01-01T00:00:00Z'), record('b', '2026-01-01T00:00:00Z')];
    const file = [record('c', '2026-01-01T00:00:00Z')];
    const tsMap = new Map([['b', tombstone('b', 'todo', '2026-01-02T00:00:00Z')]]);
    const result = mergeRecords(local, file, tsMap);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });
});

describe('mergeSettings', () => {
  const base: Settings = {
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    exchangeRateAutoUpdate: false,
    exchangeRateLastFetch: null,
    theme: 'light',
    language: 'en',
    syncEnabled: true,
    autoSyncEnabled: true,
    encryptionEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('returns file settings when local is null', () => {
    const result = mergeSettings(null, { ...base, updatedAt: '2026-01-02T00:00:00Z' });
    expect(result?.updatedAt).toBe('2026-01-02T00:00:00Z');
  });

  it('returns local settings when file is null', () => {
    const result = mergeSettings({ ...base, updatedAt: '2026-01-02T00:00:00Z' }, null);
    expect(result?.updatedAt).toBe('2026-01-02T00:00:00Z');
  });

  it('keeps newer settings', () => {
    const local = { ...base, updatedAt: '2026-01-01T00:00:00Z', baseCurrency: 'EUR' };
    const file = { ...base, updatedAt: '2026-01-02T00:00:00Z', baseCurrency: 'GBP' };
    const result = mergeSettings(local, file);
    expect(result?.baseCurrency).toBe('GBP');
  });
});

describe('mergeTombstones', () => {
  // Use recent dates so 30-day pruning doesn't remove them
  const recentDate1 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const recentDate2 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  it('merges tombstones from both sides', () => {
    const local = [tombstone('a', 'todo', recentDate1)];
    const file = [tombstone('b', 'account', recentDate1)];
    const result = mergeTombstones(local, file);
    expect(result).toHaveLength(2);
  });

  it('keeps newest tombstone per ID', () => {
    const local = [tombstone('a', 'todo', recentDate2)];
    const file = [tombstone('a', 'todo', recentDate1)];
    const result = mergeTombstones(local, file);
    expect(result).toHaveLength(1);
    expect(result[0]!.deletedAt).toBe(recentDate1);
  });

  it('prunes tombstones older than 30 days', () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();
    const local = [tombstone('old', 'todo', oldDate), tombstone('recent', 'todo', recentDate)];
    const result = mergeTombstones(local, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('recent');
  });
});

describe('mergeData', () => {
  function emptyData(): ExportedData {
    return {
      familyMembers: [],
      accounts: [],
      transactions: [],
      assets: [],
      goals: [],
      recurringItems: [],
      todos: [],
      deletions: [],
      settings: null,
    };
  }

  it('merges todos from both devices', () => {
    const local = {
      ...emptyData(),
      todos: [{ id: 'todo-a', title: 'Buy groceries', updatedAt: '2026-01-01T00:00:00Z' }],
    } as unknown as ExportedData;
    const file = {
      ...emptyData(),
      todos: [{ id: 'todo-b', title: 'Walk the dog', updatedAt: '2026-01-01T00:00:00Z' }],
    } as unknown as ExportedData;

    const { data } = mergeData(local, file, [], []);
    expect(data.todos).toHaveLength(2);
    const ids = data.todos!.map((t) => t.id).sort();
    expect(ids).toEqual(['todo-a', 'todo-b']);
  });

  it('propagates deletion via tombstone', () => {
    const recentRecord = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const recentDelete = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const local = {
      ...emptyData(),
      todos: [{ id: 'todo-a', title: 'Buy groceries', updatedAt: recentRecord }],
    } as unknown as ExportedData;
    const file = emptyData();

    const fileTombstones = [tombstone('todo-a', 'todo', recentDelete)];
    const { data } = mergeData(local, file, [], fileTombstones);
    expect(data.todos).toHaveLength(0);
  });

  it('preserves accounts from both sides', () => {
    const local = {
      ...emptyData(),
      accounts: [{ id: 'acc-1', name: 'Checking', updatedAt: '2026-01-01T00:00:00Z' }],
    } as unknown as ExportedData;
    const file = {
      ...emptyData(),
      accounts: [{ id: 'acc-2', name: 'Savings', updatedAt: '2026-01-01T00:00:00Z' }],
    } as unknown as ExportedData;

    const { data } = mergeData(local, file, [], []);
    expect(data.accounts).toHaveLength(2);
  });
});
