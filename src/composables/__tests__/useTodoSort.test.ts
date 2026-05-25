import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { useTodoSort, SORT_OPTIONS, TODO_SORTS } from '../useTodoSort';

const KEY = 'beanies:todoSort';

describe('useTodoSort', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults to "dueDate" when nothing is stored', () => {
    const { sortBy } = useTodoSort();
    expect(sortBy.value).toBe('dueDate');
  });

  it('reads a valid stored preference', () => {
    localStorage.setItem(KEY, 'oldest');
    const { sortBy } = useTodoSort();
    expect(sortBy.value).toBe('oldest');
  });

  it('persists a change to localStorage (write-through)', async () => {
    const { sortBy } = useTodoSort();
    sortBy.value = 'newest';
    await nextTick();
    expect(localStorage.getItem(KEY)).toBe('newest');
  });

  it('round-trips: a persisted change is read back by a fresh instance', async () => {
    const first = useTodoSort();
    first.sortBy.value = 'oldest';
    await nextTick();
    const second = useTodoSort();
    expect(second.sortBy.value).toBe('oldest');
  });

  it('falls back to "dueDate" on an invalid stored value, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(KEY, 'bogus');
    const { sortBy } = useTodoSort();
    expect(sortBy.value).toBe('dueDate');
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to "dueDate" when reading localStorage throws, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const { sortBy } = useTodoSort();
    expect(sortBy.value).toBe('dueDate');
    expect(warn).toHaveBeenCalled();
  });

  it('does not crash when writing localStorage throws; warns and keeps the in-memory value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const { sortBy } = useTodoSort();
    expect(() => {
      sortBy.value = 'newest';
    }).not.toThrow();
    await nextTick();
    expect(sortBy.value).toBe('newest'); // in-memory still updates
    expect(warn).toHaveBeenCalled();
  });

  it('SORT_OPTIONS covers exactly the TODO_SORTS set (no drift)', () => {
    expect([...SORT_OPTIONS.map((o) => o.value)].sort()).toEqual([...TODO_SORTS].sort());
  });
});
