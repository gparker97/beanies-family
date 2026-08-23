import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRecurringItemLive, __resetFallbackDedupeForTests } from '../adapters';
import { recurringTemplateFields } from '@/utils/recurringItemFields';
import type { RecurringItem, CreateRecurringItemInput } from '@/types/models';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const base: RecurringItem = {
  id: 'ri-1',
  accountId: 'acc-1',
  type: 'expense',
  amount: 200,
  currency: 'USD',
  category: 'utilities',
  description: 'Broadband',
  frequency: 'monthly',
  dayOfMonth: 1,
  startDate: '2026-01-01',
  isActive: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('isRecurringItemLive — an exhausted series must stop counting (#70)', () => {
  beforeEach(() => __resetFallbackDedupeForTests());

  it('drops a spent afterCount series, whose end lives ONLY in rule.end', () => {
    // The defect: `endDate` stays undefined for an afterCount end, so every
    // money surface that gated on it counted the series forever — a $200/month
    // expense set to "ends after 12 times" still showed $200/month of recurring
    // expense a year after it finished.
    const item: RecurringItem = {
      ...base,
      rule: {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 1,
        end: { kind: 'afterCount', count: 12 },
      },
    };
    expect(isRecurringItemLive(item, '2026-06-01')).toBe(true); // mid-run
    expect(isRecurringItemLive(item, '2027-06-01')).toBe(false); // long spent
  });

  it('drops a series past its onDate end', () => {
    const item: RecurringItem = { ...base, endDate: '2026-03-31' };
    expect(isRecurringItemLive(item, '2026-02-01')).toBe(true);
    expect(isRecurringItemLive(item, '2026-05-01')).toBe(false);
  });

  it('keeps a never-ending series', () => {
    expect(isRecurringItemLive(base, '2030-01-01')).toBe(true);
  });

  it('treats an UNMAPPABLE item as live — a reporting bug must never hide money', () => {
    const item = { ...base, frequency: 'fortnightly' as never };
    expect(isRecurringItemLive(item, '2030-01-01')).toBe(true);
  });
});

describe('recurringTemplateFields strips the pre-split rule (#70)', () => {
  it('omits `rule`, so a split does not restore the original afterCount', () => {
    // The split already re-anchored and re-based the cadence; replaying the
    // form's rule over it restored the ORIGINAL count against the NEW anchor —
    // a 10-instalment plan split at instalment 4 materializing 13 transactions.
    const data = {
      ...base,
      rule: {
        unit: 'month',
        interval: 1,
        monthlyAnchor: 'date',
        monthlyDay: 1,
        end: { kind: 'afterCount', count: 10 },
      },
    } as unknown as CreateRecurringItemInput;
    const fields = recurringTemplateFields(data, '');
    expect('rule' in fields).toBe(false);
    expect('startDate' in fields).toBe(false);
    expect('lastProcessedDate' in fields).toBe(false);
    // Non-schedule fields still apply — this is an edit, after all.
    expect(fields.amount).toBe(200);
    expect(fields.description).toBe('Broadband');
  });
});
