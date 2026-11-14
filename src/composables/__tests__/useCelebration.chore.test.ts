/**
 * The chore celebration's orchestration (#146): `celebrateChore` picks the weekday's move, a
 * sound (never the last one) and a praise line (never the last one), plays the chore sound
 * (never the list fanfare), and runs its phases on its own timers. The banner waits for the
 * store's commit; an abandoned prediction ends quietly after its burst. Celebrations are
 * concurrent per bean and block, and overlapping ones share one sound. List completion keeps the
 * old shower and fanfare. Reduced motion is calm; no anchor plays centered (and says so); the
 * surface's cap is honoured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const sounds = vi.hoisted(() => ({
  playFanfare: vi.fn(),
  playChime: vi.fn(),
  playChoreCelebrationSound: vi.fn(),
  cancelChoreCelebrationSound: vi.fn(),
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
  CELEBRATION_SOUND_GAP_MS,
  abandonChoreCelebration,
  celebrate,
  celebrateChore,
  choreBannerCelebration,
  choreBlockHeld,
  commitChoreCelebration,
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

const active = (key = 'pip:morning') => useCelebration().activeChores.value.get(key) ?? null;
/** A committed celebration (the store has written its mark), as most tests want. */
const start = (over: Partial<ChoreCelebrationRequest> = {}) =>
  celebrateChore(request(over), { committed: true });

describe('celebrateChore', () => {
  it('plays the weekday move with its chore sound, never the shower or the fanfare', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // no cheer this time
    start();
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
    start();
    expect(active()!.move).toBe('drop-in');
  });

  it('banner at 560 ms, gone at 3060 ms, on its own timers', () => {
    start();
    expect(choreBlockHeld('pip', 'morning')).toBe(true);
    expect(choreBannerCelebration('pip', 'morning')).toBeNull();
    vi.advanceTimersByTime(560);
    expect(active()!.phase).toBe('banner');
    expect(choreBlockHeld('pip', 'morning')).toBe(false);
    expect(choreBannerCelebration('pip', 'morning')).toEqual({
      words: active()!.praiseWords,
      calm: false,
    });
    // Another bean's block, or another block, is never the one celebrating.
    expect(choreBannerCelebration('juno', 'morning')).toBeNull();
    expect(choreBannerCelebration('pip', 'evening')).toBeNull();
    vi.advanceTimersByTime(2499);
    expect(active()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(active()).toBeNull();
  });

  it('never the same sound twice in a row, remembered across a reload', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    start();
    expect(active()!.sound).toBe('marimba');
    expect(localStorage.getItem('beanies.choreCelebration.lastSound')).toBe('marimba');
    useCelebration().dismissChoreCelebration();
    start();
    expect(active()!.sound).toBe('kids-cheer');
    // A fresh session (memory gone) still reads the last sound from storage.
    resetChoreCelebrationForTest();
    localStorage.setItem('beanies.choreCelebration.lastSound', 'marimba');
    start();
    expect(active()!.sound).toBe('kids-cheer');
    vi.mocked(Math.random).mockRestore();
  });

  it('never the same praise line twice in a row', () => {
    let last = '';
    for (let i = 0; i < 40; i++) {
      useCelebration().dismissChoreCelebration();
      start();
      const praise = active()!.praise;
      expect(praise).not.toBe(last);
      last = praise;
    }
  });

  it('reduced motion: calm, the banner once committed, a shorter end, sound still plays', () => {
    reduced = true;
    start();
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
    start({ anchor: null });
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
    start();
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
    start();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({
          action: 'fallback-sound',
          detail: 'marimba',
          stage: 'fallback',
        }),
      })
    );
  });

  it('sounds not loaded in time: the fanfare played, logged as a warning', async () => {
    sounds.playChoreCelebrationSound.mockResolvedValue('fanfare-late');
    start();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'fallback-fanfare', stage: 'late' }),
      })
    );
  });

  it('a block unticked during the burst: no banner, the celebration ends quietly', () => {
    let done = true;
    start({ stillDone: () => done });
    done = false;
    vi.advanceTimersByTime(560);
    expect(active()).toBeNull();
    expect(choreBannerCelebration('pip', 'morning')).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'ended-quietly', detail: 'undone' }),
      })
    );
  });

  it('settled (found done only after its write): the banner from the start, no burst hold', () => {
    start({ settled: true });
    expect(active()!.phase).toBe('banner');
    expect(choreBlockHeld('pip', 'morning')).toBe(false);
    expect(choreBannerCelebration('pip', 'morning')).not.toBeNull();
  });

  it('dismissed (route change, block gone, no longer done): its waiting sound never starts', () => {
    start();
    expect(sounds.cancelChoreCelebrationSound).not.toHaveBeenCalled();
    useCelebration().dismissChoreCelebration();
    expect(sounds.cancelChoreCelebrationSound).toHaveBeenCalledTimes(1);
  });

  it('a sound that did not start (superseded, muted) is logged at debug, so rates read true', async () => {
    sounds.playChoreCelebrationSound.mockResolvedValue('superseded');
    start();
    await vi.runAllTicks();
    await Promise.resolve();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        context: expect.objectContaining({ action: 'sound-skipped', stage: 'superseded' }),
      })
    );
  });

  it('a prediction: the burst at once, the banner only on commit, then on time', () => {
    const key = celebrateChore(request())!;
    expect(choreBlockHeld('pip', 'morning')).toBe(true);
    vi.advanceTimersByTime(700); // the burst is over, but no commit yet: still holding the rows
    expect(active()!.phase).toBe('burst');
    commitChoreCelebration(key);
    expect(active()!.phase).toBe('banner');
  });

  it('a prediction that does not hold ends quietly after its burst, with its reason', () => {
    const key = celebrateChore(request())!;
    abandonChoreCelebration(key, 'not-done');
    expect(active()).toBeNull();
    expect(choreBlockHeld('pip', 'morning')).toBe(false);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        context: expect.objectContaining({ action: 'ended-quietly', detail: 'not-done' }),
      })
    );
  });

  it('two beans finishing 0 ms apart: both celebrations play whole, one sound', () => {
    start({ memberId: 'pip' });
    start({ memberId: 'juno' });
    expect(useCelebration().activeChores.value.size).toBe(2);
    expect(sounds.playChoreCelebrationSound).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'sound-skipped', stage: 'overlap' }),
      })
    );
    vi.advanceTimersByTime(560);
    expect(active('pip:morning')!.phase).toBe('banner');
    expect(active('juno:morning')!.phase).toBe('banner');
    expect(choreBannerCelebration('pip', 'morning')).not.toBeNull();
    expect(choreBannerCelebration('juno', 'morning')).not.toBeNull();
    vi.advanceTimersByTime(2500);
    expect(useCelebration().activeChores.value.size).toBe(0);
  });

  it('two beans 1.5 s apart: the first is never cut off; the second plays silently', () => {
    start({ memberId: 'pip' });
    vi.advanceTimersByTime(1500);
    start({ memberId: 'juno' });
    expect(sounds.cancelChoreCelebrationSound).not.toHaveBeenCalled();
    expect(sounds.playChoreCelebrationSound).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(active('pip:morning')!.phase).toBe('banner'); // still playing its whole move
    vi.advanceTimersByTime(60);
    expect(active('pip:morning')).toBeNull(); // ended on its own time
    expect(active('juno:morning')!.phase).toBe('banner');
    vi.advanceTimersByTime(1500);
    expect(active('juno:morning')).toBeNull();
    // Outside the window, the next celebration has its sound again.
    vi.advanceTimersByTime(CELEBRATION_SOUND_GAP_MS);
    start({ memberId: 'sib' });
    expect(sounds.playChoreCelebrationSound).toHaveBeenCalledTimes(2);
  });

  it('the same bean and block never run twice at once', () => {
    expect(start()).toBe('pip:morning');
    expect(start()).toBeNull();
    expect(useCelebration().activeChores.value.size).toBe(1);
  });

  it('dismissing one leaves the other; dismissing all clears both', () => {
    start({ memberId: 'pip' });
    start({ memberId: 'juno' });
    useCelebration().dismissChoreCelebration('pip:morning');
    expect(active('pip:morning')).toBeNull();
    expect(active('juno:morning')).not.toBeNull();
    useCelebration().dismissChoreCelebration();
    expect(useCelebration().activeChores.value.size).toBe(0);
  });

  it('honours a surface’s shorter cap, and still plays where routine ones are suppressed', () => {
    setCelebrationMode({ autoDismissMs: 1500, suppressRoutine: true });
    start();
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
