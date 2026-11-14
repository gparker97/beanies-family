/**
 * The chore celebration's sounds (#146) on a fake Web Audio graph: the seven synthesized sounds
 * play through the one output chain, the mute gate holds, and the kids cheer loads only on its
 * first need, decodes once, and falls back to the paired synthesized sound (reported once) when
 * it cannot load.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import {
  CHEER_URL,
  playChoreCelebrationSound,
  resetCelebrationSoundsForTest,
  setSoundEnabled,
} from '@/composables/useSounds';
import { CELEBRATION_SOUNDS } from '@/constants/celebrationSounds';

// ── A small fake of the Web Audio API: enough to build the chain and schedule notes ──

const param = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
});

function node(extra: Record<string, unknown> = {}) {
  const n: Record<string, unknown> = {
    connect: vi.fn((to: unknown) => to),
    ...extra,
  };
  return n;
}

let created: { osc: number; sources: Array<{ start: ReturnType<typeof vi.fn> }>; decodes: number };

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  createGain = () => node({ gain: param() });
  createBiquadFilter = () => node({ type: '', Q: param(), frequency: param() });
  createDynamicsCompressor = () => node({ threshold: param(), ratio: param() });
  createConvolver = () => node({ buffer: null });
  createOscillator = () => {
    created.osc++;
    return node({ type: '', frequency: param(), detune: param(), start: vi.fn(), stop: vi.fn() });
  };
  createBufferSource = () => {
    const s = node({ buffer: null, loop: false, start: vi.fn(), stop: vi.fn() });
    created.sources.push(s as never);
    return s;
  };
  createBuffer = (channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
    numberOfChannels: channels,
  });
  decodeAudioData = (_b: ArrayBuffer, ok: (b: unknown) => void, fail: (e: unknown) => void) => {
    created.decodes++;
    if (decodeShouldFail) fail(new Error('bad mp3'));
    else ok({ duration: 1.8 });
  };
  resume = () => Promise.resolve();
}

let decodeShouldFail = false;
const fetchMock = vi.fn();

beforeEach(() => {
  created = { osc: 0, sources: [], decodes: 0 };
  decodeShouldFail = false;
  reportError.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('fetch', fetchMock);
  resetCelebrationSoundsForTest();
  setSoundEnabled(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const noteCount = (id: keyof typeof CELEBRATION_SOUNDS) =>
  CELEBRATION_SOUNDS[id].events.reduce((n, e) => n + e.notes.length, 0);

describe('playChoreCelebrationSound', () => {
  it('a synthesized sound schedules its notes and never fetches the cheer', async () => {
    expect(await playChoreCelebrationSound('marimba', 'marimba')).toBe('played');
    // Every marimba note has three partials.
    expect(created.osc).toBe(noteCount('marimba') * 3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('muted: nothing is built, nothing plays', async () => {
    setSoundEnabled(false);
    expect(await playChoreCelebrationSound('kids-cheer', 'tada')).toBe('muted');
    expect(created.osc).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no Web Audio: unavailable, quietly', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(await playChoreCelebrationSound('glock', 'glock')).toBe('unavailable');
  });

  it('the cheer loads on its first need, decodes once, and plays through the chain', async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await playChoreCelebrationSound('kids-cheer', 'toot')).toBe('played');
    expect(fetchMock).toHaveBeenCalledWith(CHEER_URL);
    expect(created.decodes).toBe(1);
    const cheer = created.sources.find((s) => (s as unknown as { buffer: unknown }).buffer);
    expect(cheer?.start).toHaveBeenCalled();
    // A second cheer reuses the decoded buffer.
    await playChoreCelebrationSound('kids-cheer', 'toot');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(created.decodes).toBe(1);
    expect(created.osc).toBe(0);
  });

  it('a cheer that cannot be fetched: the paired sound plays, reported once as a warning', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await playChoreCelebrationSound('kids-cheer', 'tada')).toBe('fallback');
    expect(created.osc).toBeGreaterThan(0);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      surface: 'sounds',
      severity: 'warning',
      context: { action: 'cheer-load', stage: 'fetch' },
    });
    // Tried again next time (not cached as broken), but never reported twice.
    expect(await playChoreCelebrationSound('kids-cheer', 'tada')).toBe('fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('a 404 and a bad decode are classified', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    expect(await playChoreCelebrationSound('kids-cheer', 'pizz')).toBe('fallback');
    expect(reportError.mock.calls[0]![0]).toMatchObject({
      context: { action: 'cheer-load', stage: 'fetch', http_status: 404 },
    });
    resetCelebrationSoundsForTest();
    reportError.mockClear();
    decodeShouldFail = true;
    expect(await playChoreCelebrationSound('kids-cheer', 'pizz')).toBe('fallback');
    expect(reportError.mock.calls[0]![0]).toMatchObject({ context: { stage: 'decode' } });
  });
});
