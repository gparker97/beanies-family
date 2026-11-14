/**
 * The chore celebration's orchestration (#146): `celebrate('chore-block-complete')` picks the
 * weekday's move, a sound (never the last one) and a praise line (never the last one), plays the
 * chore sound (never the list fanfare), and runs its two phases on its own timers. List completion
 * keeps the old shower and fanfare. Reduced motion is calm; no anchor plays centered (and says
 * so); the surface's cap is honoured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const sounds = vi.hoisted(() => ({
  playFanfare: vi.fn(),
  playChime: vi.fn(),
  playChoreCelebrationSound: vi.fn(),
}));
vi.mock('@/composables/useSounds', () => sounds);
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (key: string) => key }),
}));

import {
  celebrate,
  choreBannerCelebration,
  choreBlockHeld,
  resetCelebrationMode,
  resetChoreCelebrationForTest,
  setCelebrationMode,
  useCelebration,
  type ChoreCelebrationRequest,
} from '@/composables/useCelebration';
import type { ChoreCelebrationAnchor } from '@/utils/choreCelebration';

const MONDAY = new Date(2026, 10, 16, 7, 42);
const THURSDAY = new Date(2026, 10, 19, 7, 42);

function anchor(): ChoreCelebrationAnchor {
  const block = document.createElement('section');
  return {
    block,
    blockAt: { x: 0, y: 0, w: 300, h: 200 },
    tickEl: null,
    tick: { x: 240, y: 150, w: 52, h: 52 },
    clip: null,
    compact: false,
  };
}

function request(over: Partial<ChoreCelebrationRequest> = {}): ChoreCelebrationRequest {
  return {
    memberId: 'pip',
    block: 'morning',
    beanName: 'Pip',
    count: 4,
    anchor: anchor(),
    ...over,
  };
}

let reduced = false;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY);
  reduced = false;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduced-motion') ? reduced : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  localStorage.clear();
  sounds.playFanfare.mockClear();
  sounds.playChime.mockClear();
  sounds.playChoreCelebrationSound.mockReset();
  sounds.playChoreCelebrationSound.mockResolvedValue('played');
  logEvent.mockClear();
  reportError.mockClear();
  resetCelebrationMode();
  resetChoreCelebrationForTest();
});

afterEach(() => {
  resetChoreCelebrationForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const active = () => useCelebration().activeChore.value;

describe('celebrate("chore-block-complete")', () => {
  it('plays the weekday move with its chore sound, never the shower or the fanfare', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // no cheer this time
    celebrate('chore-block-complete', { chore: request() });
    const c = active()!;
    expect(c.move).toBe('bounce-party');
    expect(c.sound).toBe('marimba');
    expect(c.phase).toBe('burst');
    expect(sounds.playChoreCelebrationSound).toHaveBeenCalledWith('marimba', 'marimba');
    expect(sounds.playFanfare).not.toHaveBeenCalled();
    expect(useCelebration().activeShower.value).toBeNull();
    vi.mocked(Math.random).mockRestore();
  });

  it('the move follows the device’s day', () => {
    vi.setSystemTime(THURSDAY);
    celebrate('chore-block-complete', { chore: request() });
    expect(active()!.move).toBe('drop-in');
  });

  it('banner at 560 ms, gone at 3060 ms, on its own timers', () => {
    celebrate('chore-block-complete', { chore: request() });
    expect(choreBlockHeld('pip', 'morning')).toBe(true);
    expect(choreBannerCelebration('pip', 'morning')).toBeNull();
    vi.advanceTimersByTime(560);
    expect(active()!.phase).toBe('banner');
    expect(choreBlockHeld('pip', 'morning')).toBe(false);
    expect(choreBannerCelebration('pip', 'morning')).toMatchObject({ name: 'Pip', calm: false });
    // Another bean's block, or another block, is never the one celebrating.
    expect(choreBannerCelebration('juno', 'morning')).toBeNull();
    expect(choreBannerCelebration('pip', 'evening')).toBeNull();
    vi.advanceTimersByTime(2499);
    expect(active()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(active()).toBeNull();
  });

  it('a new celebration replaces the last one and cancels its timers', () => {
    celebrate('chore-block-complete', { chore: request() });
    const first = active()!.id;
    vi.advanceTimersByTime(2000);
    celebrate('chore-block-complete', { chore: request({ block: 'evening' }) });
    expect(active()!.id).not.toBe(first);
    expect(active()!.phase).toBe('burst');
    vi.advanceTimersByTime(1100); // the first one's end would have landed here
    expect(active()).not.toBeNull();
  });

  it('never the same sound twice in a row, remembered across a reload', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    celebrate('chore-block-complete', { chore: request() });
    expect(active()!.sound).toBe('marimba');
    expect(localStorage.getItem('beanies.choreCelebration.lastSound')).toBe('marimba');
    celebrate('chore-block-complete', { chore: request() });
    expect(active()!.sound).toBe('kids-cheer');
    // A fresh session (memory gone) still reads the last sound from storage.
    resetChoreCelebrationForTest();
    localStorage.setItem('beanies.choreCelebration.lastSound', 'marimba');
    celebrate('chore-block-complete', { chore: request() });
    expect(active()!.sound).toBe('kids-cheer');
    vi.mocked(Math.random).mockRestore();
  });

  it('never the same praise line twice in a row', () => {
    let last = '';
    for (let i = 0; i < 40; i++) {
      celebrate('chore-block-complete', { chore: request() });
      const praise = active()!.praise;
      expect(praise).not.toBe(last);
      last = praise;
    }
  });

  it('reduced motion: calm, the banner from the start, a shorter end, sound still plays', () => {
    reduced = true;
    celebrate('chore-block-complete', { chore: request() });
    const c = active()!;
    expect(c.calm).toBe(true);
    expect(c.phase).toBe('banner');
    expect(c.endsAt).toBe(2900);
    expect(choreBlockHeld('pip', 'morning')).toBe(false);
    expect(choreBannerCelebration('pip', 'morning')).toMatchObject({ calm: true });
    expect(sounds.playChoreCelebrationSound).toHaveBeenCalled();
    vi.advanceTimersByTime(2900);
    expect(active()).toBeNull();
  });

  it('no anchor: plays centered, logs a warning, and holds no block on the board', () => {
    celebrate('chore-block-complete', { chore: request({ anchor: null }) });
    expect(active()!.anchor).toBeNull();
    expect(choreBlockHeld('pip', 'morning')).toBe(false);
    vi.advanceTimersByTime(560);
    expect(choreBannerCelebration('pip', 'morning')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'fallback-centered', detail: 'no-anchor' }),
      })
    );
  });

  it('logs one info event with allowlisted context when it plays', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    celebrate('chore-block-complete', { chore: request() });
    const info = logEvent.mock.calls.map((c) => c[0]).filter((e) => e.level === 'info');
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({
      surface: 'chore-celebration',
      context: {
        action: 'play',
        kind: 'bounce-party',
        detail: 'marimba',
        count: 4,
        slot: 'morning',
        stage: 'anchored',
        format: 'full',
      },
    });
    vi.mocked(Math.random).mockRestore();
  });

  it('a cheer that fell back to the paired sound is logged as a warning', async () => {
    sounds.playChoreCelebrationSound.mockResolvedValue('fallback');
    celebrate('chore-block-complete', { chore: request() });
    await vi.runAllTicks();
    await Promise.resolve();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'fallback-sound', detail: 'marimba' }),
      })
    );
  });

  it('honours a surface’s shorter cap, and still plays where routine ones are suppressed', () => {
    setCelebrationMode({ autoDismissMs: 1500, suppressRoutine: true });
    celebrate('chore-block-complete', { chore: request() });
    expect(active()!.endsAt).toBe(1500);
    vi.advanceTimersByTime(1500);
    expect(active()).toBeNull();
  });
});

describe('list completion keeps the old shower', () => {
  it('list-complete: the white-box shower and the fanfare, no chore celebration', () => {
    celebrate('list-complete');
    expect(useCelebration().activeShower.value).not.toBeNull();
    expect(sounds.playFanfare).toHaveBeenCalledTimes(1);
    expect(sounds.playChoreCelebrationSound).not.toHaveBeenCalled();
    expect(active()).toBeNull();
    useCelebration().dismissShower();
  });
});
