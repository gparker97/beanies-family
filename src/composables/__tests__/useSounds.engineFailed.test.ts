/**
 * The celebration sound engine's chunk fails to load (#146): the fanfare plays at once, labelled
 * `fanfare-failed` (not late), the failure is reported once for the episode, and later
 * celebrations within the backoff do not retry or report again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audio, FakeAudioContext } from './fakeAudio';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError }));

import {
  playChoreCelebrationSound,
  resetCelebrationSoundsForTest,
  setSoundEnabled,
} from '@/composables/useSounds';

beforeEach(() => {
  audio.reset();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  resetCelebrationSoundsForTest(() => Promise.reject(new Error('chunk failed to load')));
  setSoundEnabled(true);
  reportError.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe('playChoreCelebrationSound with the engine failing to load', () => {
  it('plays the fanfare as a failure (not late), reported once per episode', async () => {
    expect(await playChoreCelebrationSound('marimba', 'marimba')).toBe('fanfare-failed');
    expect(audio.osc).toBe(4);
    expect(await playChoreCelebrationSound('tada', 'tada')).toBe('fanfare-failed');
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      surface: 'sounds',
      severity: 'warning',
      context: { action: 'engine-load', stage: 'import' },
    });
  });
});
