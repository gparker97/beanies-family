/**
 * `playChoreCelebrationSound` (#146): the gate in front of the code-split engine. Muted plays
 * nothing; the engine gets the shared context, a deadline and a token, so a newer celebration
 * supersedes an older one; muting during the wait silences it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAudioContext } from './fakeAudio';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
const engine = vi.hoisted(() => ({ playCelebrationSound: vi.fn() }));
vi.mock('@/composables/choreCelebrationSounds', () => engine);

import {
  CELEBRATION_SOUND_CUTOFF_MS,
  playChoreCelebrationSound,
  resetCelebrationSoundsForTest,
  setSoundEnabled,
} from '@/composables/useSounds';

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  engine.playCelebrationSound.mockReset();
  engine.playCelebrationSound.mockResolvedValue('played');
  resetCelebrationSoundsForTest();
  setSoundEnabled(true);
});

afterEach(() => vi.unstubAllGlobals());

describe('playChoreCelebrationSound', () => {
  it('hands the engine the shared context and a gate with the cutoff deadline', async () => {
    const before = performance.now();
    expect(await playChoreCelebrationSound('glock', 'glock')).toBe('played');
    const [ctx, id, fallback, gate] = engine.playCelebrationSound.mock.calls[0]!;
    expect(ctx).toBeInstanceOf(FakeAudioContext);
    expect([id, fallback]).toEqual(['glock', 'glock']);
    expect(gate.deadline).toBeGreaterThanOrEqual(before + CELEBRATION_SOUND_CUTOFF_MS);
    expect(gate.enabled()).toBe(true);
    expect(gate.current()).toBe(true);
    // The same context next time.
    await playChoreCelebrationSound('toot', 'toot');
    expect(engine.playCelebrationSound.mock.calls[1]![0]).toBe(ctx);
  });

  it('muted: nothing loads or plays', async () => {
    setSoundEnabled(false);
    expect(await playChoreCelebrationSound('kids-cheer', 'tada')).toBe('muted');
    expect(engine.playCelebrationSound).not.toHaveBeenCalled();
  });

  it('no Web Audio: unavailable, quietly', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(await playChoreCelebrationSound('glock', 'glock')).toBe('unavailable');
  });

  it('a newer celebration supersedes the older one’s gate; muting is read live', async () => {
    await playChoreCelebrationSound('kids-cheer', 'tada');
    const first = engine.playCelebrationSound.mock.calls[0]![3];
    await playChoreCelebrationSound('marimba', 'marimba');
    const second = engine.playCelebrationSound.mock.calls[1]![3];
    expect(first.current()).toBe(false);
    expect(second.current()).toBe(true);
    setSoundEnabled(false);
    expect(second.enabled()).toBe(false);
  });
});
