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
