import { describe, it, expect, vi } from 'vitest';
import { wasHiddenSince, getHiddenDurationMs } from '@/utils/visibilityTracker';

/** Drive a real visibilitychange transition against the module singleton. */
function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}

// The tracker is a module singleton (lastHiddenAt/lastVisibleAt persist across
// tests in this file), so the transitions are driven inside a single sequential
// test per concern, in file order.
describe('visibilityTracker — wasHiddenSince', () => {
  it('covers clean, hidden-now, hidden-since, and armed-while-hidden (resume-transition) windows', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      // Clean window — never hidden this session.
      expect(wasHiddenSince(Date.now() - 1_000)).toBe(false);

      // Hidden right now → true regardless of window.
      setVisibility('hidden'); // lastHiddenAt = 1_000_000
      expect(wasHiddenSince(Date.now())).toBe(true);

      // Resume after 5s.
      vi.advanceTimersByTime(5_000);
      setVisibility('visible'); // lastVisibleAt = 1_005_000

      // A window opened BEFORE the hidden transition → hidden-since.
      expect(wasHiddenSince(999_500)).toBe(true);

      // Armed-while-hidden: the window opened AFTER lastHiddenAt but BEFORE the
      // resume (e.g. the backgrounding flush armed as the page hid). Detected via
      // the resume transition (lastVisibleAt >= since).
      expect(wasHiddenSince(1_000_500)).toBe(true);

      // A clean window opened after the resume → false.
      vi.advanceTimersByTime(1_000);
      expect(wasHiddenSince(Date.now())).toBe(false);
    } finally {
      vi.useRealTimers();
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    }
  });
});

describe('visibilityTracker — getHiddenDurationMs', () => {
  it('reports the last hidden duration after a hide→show cycle', () => {
    vi.useFakeTimers({ now: 2_000_000 });
    try {
      setVisibility('hidden');
      vi.advanceTimersByTime(7_000);
      setVisibility('visible');
      expect(getHiddenDurationMs()).toBe(7_000);
    } finally {
      vi.useRealTimers();
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    }
  });
});
