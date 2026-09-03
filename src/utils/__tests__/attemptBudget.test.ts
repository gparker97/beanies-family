/**
 * The budget behind the text-share quota (#83).
 *
 * ⚠️ The single most important case in this file is `survives a reload with attempts spent
 * and no cooldown`. That is the exact behaviour `usePinAttemptLimit.persist()` would have
 * silently dropped — it writes an entry only when `lockedUntil > Date.now()`, so a budget
 * with no cooldown would persist as nothing and a reload would hand back a fresh 20. It is
 * the whole reason this module is standalone rather than a refactor of that one, and the bug
 * would have shipped green because the PIN suite does not exercise it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  peekAttempt,
  consumeAttempt,
  clearAttempts,
  __resetAttemptBudgetForTests,
  type BudgetPolicy,
} from '../attemptBudget';

const POLICY: BudgetPolicy = { max: 3, windowMs: 60_000 };
const KEY = 'share-text:fam-1';

/**
 * The persisted shape is `{ [key]: { w: windowMs, t: [timestamps] } }`. The window is stored
 * per entry so pruning every key on every write cannot expire another policy's entries early.
 */
function stored(): Record<string, { w: number; t: number[] } | undefined> {
  return JSON.parse(localStorage.getItem('beanies_share_budget') ?? '{}');
}

beforeEach(() => {
  __resetAttemptBudgetForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Force the next read to hydrate from storage, as a page reload would. */
function simulateReload() {
  // Deliberately NOT `__resetAttemptBudgetForTests` — that clears storage too, which is the
  // thing under test. This drops only the in-memory map.
  const stored = localStorage.getItem('beanies_share_budget');
  __resetAttemptBudgetForTests();
  if (stored) localStorage.setItem('beanies_share_budget', stored);
}

describe('attemptBudget', () => {
  describe('peek vs consume', () => {
    it('peek does not spend anything, however often it is called', () => {
      for (let i = 0; i < 10; i += 1) expect(peekAttempt(KEY, POLICY).ok).toBe(true);
      // All three are still available.
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(false);
    });

    it('peek reports the refusal once the budget is spent', () => {
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      const verdict = peekAttempt(KEY, POLICY);
      expect(verdict).toMatchObject({ ok: false, reason: 'quota' });
    });

    it('a refused consume does not spend an attempt either', () => {
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      // Refused now. Advance far enough for exactly the first attempt to age out.
      expect(consumeAttempt(KEY, POLICY).ok).toBe(false);
      vi.advanceTimersByTime(60_001);
      // If the refusals had been recorded, this would still be refused.
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
    });
  });

  describe('the window', () => {
    it('frees a slot once the oldest attempt ages out', () => {
      consumeAttempt(KEY, POLICY);
      vi.advanceTimersByTime(30_000);
      consumeAttempt(KEY, POLICY);
      consumeAttempt(KEY, POLICY);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(false);

      // 30s more puts the FIRST attempt outside the 60s window; the other two are still in.
      vi.advanceTimersByTime(30_001);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(false);
    });

    it('reports resetsAt as when the OLDEST live attempt ages out', () => {
      const start = Date.now();
      consumeAttempt(KEY, POLICY);
      vi.advanceTimersByTime(10_000);
      consumeAttempt(KEY, POLICY);
      consumeAttempt(KEY, POLICY);

      const verdict = peekAttempt(KEY, POLICY);
      expect(verdict.ok).toBe(false);
      // The first attempt + the window — not the last, which would overstate the wait.
      if (!verdict.ok) expect(verdict.resetsAt).toBe(start + POLICY.windowMs);
    });

    it('is fully clear once the whole window has passed', () => {
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      vi.advanceTimersByTime(POLICY.windowMs + 1);
      expect(peekAttempt(KEY, POLICY).ok).toBe(true);
    });
  });

  describe('persistence', () => {
    it('survives a reload with attempts spent and NO cooldown', () => {
      // ⚠️ THE case. See the file header.
      consumeAttempt(KEY, POLICY);
      consumeAttempt(KEY, POLICY);

      simulateReload();

      // One left, not a fresh three.
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(false);
    });

    it('carries resetsAt across a reload', () => {
      const start = Date.now();
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      simulateReload();

      const verdict = peekAttempt(KEY, POLICY);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.resetsAt).toBe(start + POLICY.windowMs);
    });

    it('does NOT erase a key it has not hydrated this page load', () => {
      // ⚠️ The regression this guards. Hydration is lazy and per-key, so a whole-blob write
      // built only from the in-memory Map deleted every untouched family's budget — meaning
      // switching families RESET the budget the family-scoped key exists to protect.
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      simulateReload();

      // Touch a DIFFERENT family, which is the only thing hydrated this load.
      consumeAttempt('share-text:fam-2', POLICY);

      expect(stored()[KEY]?.t).toHaveLength(3);
      expect(peekAttempt(KEY, POLICY).ok).toBe(false);
    });

    it('clearAttempts removes ONE key, not the whole store, on a fresh page load', () => {
      consumeAttempt(KEY, POLICY);
      consumeAttempt('share-text:fam-2', POLICY);
      simulateReload();

      clearAttempts(KEY);

      expect(stored()[KEY]).toBeUndefined();
      expect(stored()['share-text:fam-2']?.t).toHaveLength(1);
    });

    it('does not resurrect attempts that expired while the page was closed', () => {
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      vi.advanceTimersByTime(POLICY.windowMs + 1);
      simulateReload();
      expect(peekAttempt(KEY, POLICY).ok).toBe(true);
    });

    it('degrades to an in-memory budget when storage throws', () => {
      // Private browsing, or storage blocked by policy. Refusing every share because
      // localStorage is unavailable would be far worse than a per-page-load budget.
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      expect(() => consumeAttempt(KEY, POLICY)).not.toThrow();
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      // Still enforced within this page load.
      expect(consumeAttempt(KEY, POLICY).ok).toBe(false);
      spy.mockRestore();
    });

    it('survives a corrupt stored blob without throwing', () => {
      localStorage.setItem('beanies_share_budget', '{not json');
      expect(peekAttempt(KEY, POLICY).ok).toBe(true);
    });

    it('ignores a stored value of the wrong shape', () => {
      // Includes the pre-#83-shape bare array, so a blob from an earlier build degrades to an
      // empty budget rather than throwing on `.t`.
      localStorage.setItem('beanies_share_budget', JSON.stringify({ [KEY]: 'nope' }));
      expect(peekAttempt(KEY, POLICY).ok).toBe(true);
      __resetAttemptBudgetForTests();
      localStorage.setItem('beanies_share_budget', JSON.stringify({ [KEY]: [1, 2, 3] }));
      expect(peekAttempt(KEY, POLICY).ok).toBe(true);
    });
  });

  describe('pruning — the blob must not grow without bound', () => {
    it('removes the storage key entirely once every attempt has expired', () => {
      consumeAttempt(KEY, POLICY);
      expect(localStorage.getItem('beanies_share_budget')).not.toBeNull();

      vi.advanceTimersByTime(POLICY.windowMs + 1);
      // A write is what prunes, so trigger one on another key.
      consumeAttempt('share-text:fam-2', POLICY);

      expect(stored()[KEY]).toBeUndefined();
      expect(stored()['share-text:fam-2']?.t).toHaveLength(1);
    });

    it('does not accumulate expired timestamps under a busy key', () => {
      for (let i = 0; i < 3; i += 1) {
        consumeAttempt(KEY, POLICY);
        vi.advanceTimersByTime(POLICY.windowMs + 1);
      }
      consumeAttempt(KEY, POLICY);
      // Only the most recent survives; the other three aged out and were dropped.
      expect(stored()[KEY]?.t).toHaveLength(1);
    });

    it('discards a timestamp from the future, so a clock change cannot pin a budget shut', () => {
      // The only way to write one is a clock that has since moved backwards. Keeping it would
      // hold the budget closed until the clock caught up.
      localStorage.setItem(
        'beanies_share_budget',
        JSON.stringify({
          [KEY]: {
            w: POLICY.windowMs,
            // ⚠️ +5s, INSIDE the window. The original fixture used +10,000,000 — 166x the
            // window — so any window filter dropped it regardless, and the test passed even
            // with the future check replaced by `Math.abs(now - t) < w`. A small skew is the
            // realistic case: a clock that stepped backwards seconds, not days.
            t: [Date.now() + 5_000, Date.now() + 20_000_000, Date.now()],
          },
        })
      );
      expect(peekAttempt(KEY, POLICY).ok).toBe(true);
      // Only the one legitimate timestamp is counted.
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(true);
      expect(consumeAttempt(KEY, POLICY).ok).toBe(false);
    });
  });

  describe('the per-entry window', () => {
    const LONG: BudgetPolicy = { max: 2, windowMs: 10 * 60_000 };
    const LONG_KEY = 'other-policy:x';

    it('prunes each key against ITS OWN window, not the caller\u2019s', () => {
      // ⚠️ The mechanism the module header calls load-bearing. `persist` prunes EVERY key on
      // every write, including keys whose policy the current caller knows nothing about — so
      // without a per-entry window a short-window write would expire a long-window policy's
      // entries early. One policy ships today; this is what stops a second corrupting it.
      consumeAttempt(LONG_KEY, LONG);
      consumeAttempt(LONG_KEY, LONG);
      expect(peekAttempt(LONG_KEY, LONG).ok).toBe(false);

      // Past the SHORT window, well inside the long one, and force a write on the short key.
      vi.advanceTimersByTime(POLICY.windowMs + 1);
      consumeAttempt(KEY, POLICY);

      expect(stored()[LONG_KEY]?.t).toHaveLength(2);
      expect(peekAttempt(LONG_KEY, LONG).ok).toBe(false);
    });

    it('stores the window alongside the timestamps', () => {
      consumeAttempt(LONG_KEY, LONG);
      expect(stored()[LONG_KEY]?.w).toBe(LONG.windowMs);
    });

    it('applies a CHANGED policy window immediately to an existing key', () => {
      consumeAttempt(KEY, POLICY);
      // Same key, a policy whose window has shrunk below the age of that attempt.
      vi.advanceTimersByTime(30_000);
      expect(peekAttempt(KEY, { max: 1, windowMs: 10_000 }).ok).toBe(true);
    });
  });

  describe('scoping', () => {
    it('keeps separate budgets per key, so switching families does not inherit one', () => {
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      expect(peekAttempt(KEY, POLICY).ok).toBe(false);
      expect(peekAttempt('share-text:fam-2', POLICY).ok).toBe(true);
    });

    it('clearAttempts forgets one key and leaves the others alone', () => {
      for (let i = 0; i < 3; i += 1) consumeAttempt(KEY, POLICY);
      consumeAttempt('share-text:fam-2', POLICY);

      clearAttempts(KEY);

      expect(peekAttempt(KEY, POLICY).ok).toBe(true);
      expect(stored()[KEY]).toBeUndefined();
      expect(stored()['share-text:fam-2']?.t).toHaveLength(1);
    });
  });
});
