/**
 * The celebration sound engine is code-split (#146). If it is not loaded within the cutoff of the
 * tap (the idle warm-up has not run yet), the everyday fanfare plays at once instead, never the
 * engine's sound late.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audio, FakeAudioContext } from './fakeAudio';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError }));
const engine = { playCelebrationSound: vi.fn() };

import {
  CELEBRATION_SOUND_CUTOFF_MS,
  loadCelebrationSoundEngine,
  playChoreCelebrationSound,
  resetCelebrationSoundsForTest,
  setSoundEnabled,
} from '@/composables/useSounds';

beforeEach(() => {
  vi.useFakeTimers();
  audio.reset();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  // The engine's chunk never arrives in this file.
  resetCelebrationSoundsForTest(() => new Promise<never>(() => {}));
  setSoundEnabled(true);
  reportError.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('playChoreCelebrationSound with the engine not loaded in time', () => {
  it('plays the fanfare at the cutoff, never the engine late', async () => {
    const pending = playChoreCelebrationSound('marimba', 'marimba');
    await vi.advanceTimersByTimeAsync(CELEBRATION_SOUND_CUTOFF_MS);
    expect(await pending).toBe('fanfare-late');
    expect(audio.osc).toBe(4); // playFanfare: C5 E5 G5 C6
    expect(engine.playCelebrationSound).not.toHaveBeenCalled();
  });

  it('muted while it waited: nothing at all', async () => {
    const pending = playChoreCelebrationSound('marimba', 'marimba');
    setSoundEnabled(false);
    await vi.advanceTimersByTimeAsync(CELEBRATION_SOUND_CUTOFF_MS);
    expect(await pending).toBe('muted');
    expect(audio.osc).toBe(0);
  });

  it('a load that never settles is not cached forever: forgotten, reported once, retried later', async () => {
    const first = loadCelebrationSoundEngine();
    first.catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    // Forgotten and backing off: rejects at once, without waiting on the hung load.
    await expect(loadCelebrationSoundEngine()).rejects.toThrow(/waiting to retry/);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      surface: 'sounds',
      context: { action: 'engine-load', stage: 'stalled' },
    });
    // Five minutes on, it tries again (a fresh, pending load; no second report yet).
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    let settled = false;
    loadCelebrationSoundEngine().then(
      () => (settled = true),
      () => (settled = true)
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    // Stalls again: the same episode, so still one report; the next wait doubles.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(reportError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(loadCelebrationSoundEngine()).rejects.toThrow(/waiting to retry/);
  });
});
