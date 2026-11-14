/**
 * The chore celebration's sound engine (#146) on a fake Web Audio graph: the seven synthesized
 * sounds play through one chain; the kids cheer loads on its first need, decodes once, and never
 * starts late: not ready by the deadline, the paired sound plays at once and the cheer keeps
 * loading for next time. A failure is reported once, retried once per session, never an
 * unhandled rejection; turning sound off or a newer celebration during the wait silences it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audio, cheerResponse, FakeAudioContext } from './fakeAudio';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError }));

import {
  CHEER_URL,
  playCelebrationSound,
  resetCelebrationEngineForTest,
  type CelebrationSoundGate,
} from '@/composables/choreCelebrationSounds';
import { CELEBRATION_SOUNDS } from '@/constants/celebrationSounds';

const fetchMock = vi.fn();
let ctx: FakeAudioContext;
let on = true;
let latest = true;

function gate(cutoff = 400): CelebrationSoundGate {
  return { enabled: () => on, current: () => latest, deadline: performance.now() + cutoff };
}
const play = (id: Parameters<typeof playCelebrationSound>[1], g = gate()) =>
  playCelebrationSound(ctx as unknown as BaseAudioContext, id, 'tada', g);
const cheerStarted = () => audio.sources.some((s) => s.buffer && s.start.mock.calls.length);

beforeEach(() => {
  vi.useFakeTimers();
  audio.reset();
  ctx = new FakeAudioContext();
  on = true;
  latest = true;
  reportError.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => cheerResponse());
  vi.stubGlobal('fetch', fetchMock);
  resetCelebrationEngineForTest();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const noteCount = (id: keyof typeof CELEBRATION_SOUNDS) =>
  CELEBRATION_SOUNDS[id].events.reduce((n, e) => n + e.notes.length, 0);

describe('playCelebrationSound', () => {
  it('a synthesized sound schedules its notes and never fetches the cheer', async () => {
    expect(await play('marimba')).toBe('played');
    expect(audio.osc).toBe(noteCount('marimba') * 3); // three partials a note
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the cheer loads on its first need, decodes once, and starts', async () => {
    expect(await play('kids-cheer')).toBe('played');
    expect(fetchMock).toHaveBeenCalledWith(CHEER_URL);
    expect(audio.decodes).toBe(1);
    expect(cheerStarted()).toBe(true);
    await play('kids-cheer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audio.decodes).toBe(1);
    expect(audio.osc).toBe(0);
  });

  it('a slow cheer is never started late: the paired sound plays at the cutoff, the cheer next time', async () => {
    fetchMock.mockImplementation(() => cheerResponse(900));
    const pending = play('kids-cheer');
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toBe('late');
    expect(audio.osc).toBeGreaterThan(0); // the paired sound
    expect(cheerStarted()).toBe(false);
    await vi.advanceTimersByTimeAsync(600); // the cheer lands and is kept
    expect(cheerStarted()).toBe(false); // ...but never started for that celebration
    expect(await play('kids-cheer')).toBe('played');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a stalled fetch: the paired sound at the cutoff, nothing ever starts late', async () => {
    fetchMock.mockImplementation(() => cheerResponse(Infinity));
    const pending = play('kids-cheer');
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toBe('late');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cheerStarted()).toBe(false);
  });

  it('sound turned off during the wait: nothing plays', async () => {
    fetchMock.mockImplementation(() => cheerResponse(200));
    const pending = play('kids-cheer');
    on = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toBe('muted');
    expect(cheerStarted()).toBe(false);
    expect(audio.osc).toBe(0);
  });

  it('a newer celebration during the wait: the older one never starts', async () => {
    fetchMock.mockImplementation(() => cheerResponse(200));
    const pending = play('kids-cheer');
    latest = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toBe('superseded');
    expect(cheerStarted()).toBe(false);
    expect(audio.osc).toBe(0);
  });

  it('a failed fetch: the paired sound, reported once, retried once per session, then never', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    expect(await play('kids-cheer')).toBe('fallback');
    expect(audio.osc).toBeGreaterThan(0);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      surface: 'sounds',
      severity: 'warning',
      context: { action: 'cheer-load', stage: 'fetch' },
    });
    expect(await play('kids-cheer')).toBe('fallback'); // the one retry
    expect(await play('kids-cheer')).toBe('fallback'); // no more fetching this session
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('a decode failure is one handled failure (callback and returned promise both reject)', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    audio.decode = 'fail';
    expect(await play('kids-cheer')).toBe('fallback');
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![0]).toMatchObject({ context: { stage: 'decode' } });
  });

  it('a 404 is classified with its status', async () => {
    fetchMock.mockImplementation(() => cheerResponse(0, 404));
    expect(await play('kids-cheer')).toBe('fallback');
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      context: { action: 'cheer-load', stage: 'fetch', http_status: 404 },
    });
  });
});
