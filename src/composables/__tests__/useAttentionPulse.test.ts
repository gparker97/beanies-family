import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let reduced = false;
vi.mock('@/utils/prefersReducedMotion', () => ({ prefersReducedMotion: () => reduced }));

import { useAttentionPulse } from '@/composables/useAttentionPulse';

describe('useAttentionPulse.reveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reduced = false;
  });
  afterEach(() => vi.useRealTimers());

  function el() {
    const e = document.createElement('div');
    e.scrollIntoView = vi.fn();
    return e;
  }

  it('scrolls smoothly, then pulses once the scroll has settled', () => {
    const target = el();
    useAttentionPulse().reveal(target);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(target.classList.contains('attention-pulse')).toBe(false);
    vi.advanceTimersByTime(400);
    expect(target.classList.contains('attention-pulse')).toBe(true);
  });

  it('jumps and pulses at once under reduced motion', () => {
    reduced = true;
    const target = el();
    useAttentionPulse().reveal(target);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(target.classList.contains('attention-pulse')).toBe(true);
  });

  it('does nothing for a missing element', () => {
    expect(() => useAttentionPulse().reveal(null)).not.toThrow();
  });
});

describe('useAttentionPulse.pulse', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('removes the class on animationend', () => {
    const target = document.createElement('div');
    useAttentionPulse().pulse(target, 'key-press');
    expect(target.classList.contains('key-press')).toBe(true);
    target.dispatchEvent(new Event('animationend'));
    expect(target.classList.contains('key-press')).toBe(false);
  });

  it('never leaves the class stuck when animationend never fires', () => {
    const target = document.createElement('div');
    const { pulse } = useAttentionPulse();
    pulse(target, 'card-bounce');
    vi.advanceTimersByTime(2000);
    // A re-trigger restarts the fallback instead of being cut short by the first one.
    pulse(target, 'card-bounce');
    vi.advanceTimersByTime(2000);
    expect(target.classList.contains('card-bounce')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(target.classList.contains('card-bounce')).toBe(false);
  });

  it('ignores an animationend bubbled up from a descendant', () => {
    const target = document.createElement('div');
    const child = document.createElement('span');
    target.appendChild(child);
    useAttentionPulse().pulse(target, 'card-bounce');
    child.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(target.classList.contains('card-bounce')).toBe(true);
    target.dispatchEvent(new Event('animationend'));
    expect(target.classList.contains('card-bounce')).toBe(false);
  });

  it('under reduced motion (no animationend), a stale listener cannot end a newer pulse', () => {
    const target = document.createElement('div');
    const child = document.createElement('span');
    target.appendChild(child);
    const { pulse } = useAttentionPulse();
    // First pulse: animation suppressed, so only the fallback ends it.
    pulse(target, 'key-press');
    vi.advanceTimersByTime(3000);
    expect(target.classList.contains('key-press')).toBe(false);
    // A newer pulse; a later animationend bubbling up (a child's) must not end it early.
    pulse(target, 'key-press');
    child.dispatchEvent(new Event('animationend', { bubbles: true }));
    vi.advanceTimersByTime(2900);
    expect(target.classList.contains('key-press')).toBe(true);
    // Its own fallback still ends it.
    vi.advanceTimersByTime(100);
    expect(target.classList.contains('key-press')).toBe(false);
  });

  it('a re-trigger detaches the earlier listener, so one animationend finishes one pulse', () => {
    const target = document.createElement('div');
    const remove = vi.spyOn(target.classList, 'remove');
    const { pulse } = useAttentionPulse();
    pulse(target, 'card-bounce');
    pulse(target, 'card-bounce');
    remove.mockClear();
    target.dispatchEvent(new Event('animationend'));
    // One finish, not two (the first pulse's listener is gone).
    expect(remove).toHaveBeenCalledTimes(1);
    // Pulses on different classes are independent.
    pulse(target, 'card-bounce');
    pulse(target, 'drop-flash');
    vi.advanceTimersByTime(3000);
    expect(target.classList.contains('card-bounce')).toBe(false);
    expect(target.classList.contains('drop-flash')).toBe(false);
  });
});
