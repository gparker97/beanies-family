import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForElement, waitForScrollSettle } from '@/utils/waitForElement';

describe('waitForElement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves at once when the element is already there', async () => {
    const el = document.createElement('div');
    await expect(waitForElement(() => el, 100)).resolves.toBe(el);
  });

  it('resolves the element once it appears', async () => {
    let el: HTMLElement | null = null;
    const done = waitForElement(() => el, 500);
    await vi.advanceTimersByTimeAsync(100);
    el = document.createElement('div');
    await vi.advanceTimersByTimeAsync(50);
    await expect(done).resolves.toBe(el);
  });

  it('resolves null after the deadline, and a throwing finder counts as a miss', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const done = waitForElement(() => {
      throw new Error('detached');
    }, 200);
    await vi.advanceTimersByTimeAsync(400);
    await expect(done).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('waitForScrollSettle', () => {
  const opts = { startWithinMs: 300, maxMs: 1500, quietMs: 150 };
  let scroller: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    scroller = document.createElement('main');
  });
  afterEach(() => vi.useRealTimers());

  it('resolves at once with no scroller', async () => {
    await expect(waitForScrollSettle(null, opts)).resolves.toBe('no_scroll');
  });

  it('resolves after the start window when no scroll starts', async () => {
    const done = waitForScrollSettle(scroller, opts);
    await vi.advanceTimersByTimeAsync(299);
    let settled = false;
    void done.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe('no_scroll');
  });

  it('waits past the start window for a started scroll, and resolves on scrollend', async () => {
    const done = waitForScrollSettle(scroller, opts);
    await vi.advanceTimersByTimeAsync(20);
    scroller.dispatchEvent(new Event('scroll'));
    for (let t = 0; t < 5; t++) {
      await vi.advanceTimersByTimeAsync(100);
      scroller.dispatchEvent(new Event('scroll'));
    }
    scroller.dispatchEvent(new Event('scrollend'));
    await expect(done).resolves.toBe('scrollend');
  });

  it('treats a quiet gap as the end where scrollend never fires', async () => {
    const done = waitForScrollSettle(scroller, opts);
    scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(100);
    scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(150);
    await expect(done).resolves.toBe('quiet');
  });

  it('never waits past maxMs on a scroll that keeps going', async () => {
    const done = waitForScrollSettle(scroller, opts);
    for (let t = 0; t < 20; t++) {
      scroller.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(100);
    }
    await expect(done).resolves.toBe('timeout');
  });
});
