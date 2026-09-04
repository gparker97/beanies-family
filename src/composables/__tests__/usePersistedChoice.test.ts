/**
 * The degradation cases, tested here once so the composables built on top of this one
 * (`useTodoSort`, and the cookbook's sort/group) do not each have to re-prove them.
 *
 * The load-bearing assertion in most of these is that the warn NAMES THE KEY — a generic
 * helper that warns "could not read preference" is undiagnosable without a stack trace, which
 * would be a regression on the named-composable warns this replaced.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { usePersistedChoice } from '../usePersistedChoice';

const KEY = 'beanies:testChoice';
const ALLOWED = ['a', 'b', 'c'] as const;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePersistedChoice', () => {
  it('falls back when nothing is stored, without warning', () => {
    expect(usePersistedChoice(KEY, ALLOWED, 'b').value).toBe('b');
    expect(warn).not.toHaveBeenCalled();
  });

  it('restores a valid stored value', () => {
    localStorage.setItem(KEY, 'c');
    expect(usePersistedChoice(KEY, ALLOWED, 'a').value).toBe('c');
    expect(warn).not.toHaveBeenCalled();
  });

  it('persists a change', async () => {
    const choice = usePersistedChoice(KEY, ALLOWED, 'a');
    choice.value = 'c';
    await nextTick();
    expect(localStorage.getItem(KEY)).toBe('c');
  });

  it('ignores a value that is no longer allowed, naming the key and the value', () => {
    localStorage.setItem(KEY, 'removed-mode');
    expect(usePersistedChoice(KEY, ALLOWED, 'a').value).toBe('a');
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain(KEY);
    expect(msg).toContain('removed-mode');
  });

  it('degrades when reading throws, naming the key', () => {
    // Restored by hand: the test environment serves `localStorage` through a Proxy, and
    // `vi.restoreAllMocks()` does not reach a spy installed on it — the throw would then leak
    // into every later test in the file.
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    try {
      expect(usePersistedChoice(KEY, ALLOWED, 'b').value).toBe('b');
      expect(String(warn.mock.calls[0][0])).toContain(KEY);
    } finally {
      spy.mockRestore();
    }
  });

  it('degrades when writing throws, naming the key, and keeps the ref usable', async () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });
    try {
      const choice = usePersistedChoice(KEY, ALLOWED, 'a');
      choice.value = 'c';
      await nextTick();
      expect(choice.value).toBe('c');
      expect(String(warn.mock.calls[0][0])).toContain(KEY);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps two choices on different keys independent', async () => {
    const sort = usePersistedChoice('beanies:one', ALLOWED, 'a');
    const group = usePersistedChoice('beanies:two', ALLOWED, 'a');
    sort.value = 'b';
    await nextTick();
    expect(group.value).toBe('a');
    expect(localStorage.getItem('beanies:two')).toBeNull();
  });
});
