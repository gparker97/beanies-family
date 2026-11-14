/**
 * The celebration sound engine is code-split (#146). If it is not loaded within the cutoff of the
 * tap (the idle warm-up has not run yet), the everyday fanfare plays at once instead, never the
 * engine's sound late.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audio, FakeAudioContext } from './fakeAudio';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
const engine = vi.hoisted(() => ({ playCelebrationSound: vi.fn() }));
// The engine's chunk never arrives in this file.
vi.mock('@/composables/choreCelebrationSounds', () => new Promise(() => {}));

import {
  CELEBRATION_SOUND_CUTOFF_MS,
  playChoreCelebrationSound,
  resetCelebrationSoundsForTest,
  setSoundEnabled,
} from '@/composables/useSounds';

beforeEach(() => {
  vi.useFakeTimers();
  audio.reset();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  resetCelebrationSoundsForTest();
  setSoundEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('playChoreCelebrationSound with the engine not loaded in time', () => {
  it('plays the fanfare at the cutoff, never the engine late', async () => {
    const pending = playChoreCelebrationSound('marimba', 'marimba');
    await vi.advanceTimersByTimeAsync(CELEBRATION_SOUND_CUTOFF_MS);
    expect(await pending).toBe('fanfare');
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
});
