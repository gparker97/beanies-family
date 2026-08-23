import { describe, it, expect } from 'vitest';
import { endSeriesPatch, rebaseRuleForSplit } from '../activitySeriesEnd';
import type { RecurrenceRule } from '@/types/recurrence';

const weekly = (end: RecurrenceRule['end']): RecurrenceRule => ({
  unit: 'week',
  interval: 1,
  weekdays: [1],
  end,
});

describe('endSeriesPatch — truncation reaches the AUTHORITATIVE field (#70)', () => {
  it('writes rule.end as well as the legacy shadow for a rule-bearing series', () => {
    // The bug: every "end this series here" path wrote only `recurrenceEndDate`,
    // but `expandRecurring` reads `rule.end` for a rule-bearing activity and
    // ignores the shadow — so the series was never truncated. On a split that
    // left BOTH templates expanding forever.
    const patch = endSeriesPatch({ rule: weekly({ kind: 'never' }) }, '2026-05-31');
    expect(patch.recurrenceEndDate).toBe('2026-05-31');
    expect(patch.rule?.end).toEqual({ kind: 'onDate', date: '2026-05-31' });
  });

  it('replaces an existing end rather than appending to it', () => {
    const patch = endSeriesPatch({ rule: weekly({ kind: 'afterCount', count: 20 }) }, '2026-05-31');
    expect(patch.rule?.end).toEqual({ kind: 'onDate', date: '2026-05-31' });
  });

  it('writes only the legacy field for a legacy (rule-less) series', () => {
    const patch = endSeriesPatch({ rule: undefined }, '2026-05-31');
    expect(patch).toEqual({ recurrenceEndDate: '2026-05-31' });
  });
});

describe('rebaseRuleForSplit — an afterCount end is anchor-relative (#70)', () => {
  it('subtracts the occurrences the original series already consumed', () => {
    // 10 weekly sessions from Mon 2026-01-05. Split at the 4th (2026-01-26):
    // the original keeps 3, so the replacement must carry 7 — not 10, which
    // would make the course 13 sessions long (and 16 after another split).
    const rule = weekly({ kind: 'afterCount', count: 10 });
    const rebased = rebaseRuleForSplit(rule, '2026-01-05', '2026-01-26');
    expect(rebased.end).toEqual({ kind: 'afterCount', count: 7 });
  });

  it('leaves an onDate end untouched — it is anchor-independent', () => {
    const rule = weekly({ kind: 'onDate', date: '2026-06-30' });
    expect(rebaseRuleForSplit(rule, '2026-01-05', '2026-01-26')).toBe(rule);
  });

  it('leaves a never-ending series untouched', () => {
    const rule = weekly({ kind: 'never' });
    expect(rebaseRuleForSplit(rule, '2026-01-05', '2026-01-26')).toBe(rule);
  });

  it('never produces a zero-occurrence rule (which would make the split invisible)', () => {
    const rule = weekly({ kind: 'afterCount', count: 2 });
    const rebased = rebaseRuleForSplit(rule, '2026-01-05', '2026-06-01');
    expect(rebased.end).toEqual({ kind: 'afterCount', count: 1 });
  });
});
