/**
 * A small fake of the Web Audio API for the celebration sound tests (#146): enough to build the
 * output chain, schedule notes and decode the cheer, counting what was made.
 */
import { vi } from 'vitest';

const param = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
});

function node(extra: Record<string, unknown> = {}) {
  return { connect: vi.fn((to: unknown) => to), ...extra } as Record<string, unknown>;
}

export const audio = {
  osc: 0,
  sources: [] as Array<{ buffer: unknown; start: ReturnType<typeof vi.fn> }>,
  decodes: 0,
  /** How decode ends: `ok`, `fail` (callback AND the returned promise reject), or `hang`. */
  decode: 'ok' as 'ok' | 'fail' | 'hang',
  reset() {
    this.osc = 0;
    this.sources = [];
    this.decodes = 0;
    this.decode = 'ok';
  },
};

export class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  createGain = () => node({ gain: param() });
  createBiquadFilter = () => node({ type: '', Q: param(), frequency: param() });
  createDynamicsCompressor = () => node({ threshold: param(), ratio: param() });
  createConvolver = () => node({ buffer: null });
  createOscillator = () => {
    audio.osc++;
    return node({ type: '', frequency: param(), detune: param(), start: vi.fn(), stop: vi.fn() });
  };
  createBufferSource = () => {
    const s = node({ buffer: null, loop: false, start: vi.fn(), stop: vi.fn() });
    audio.sources.push(s as never);
    return s;
  };
  createBuffer = (channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
    numberOfChannels: channels,
  });
  /** Like a modern engine: the callbacks AND a returned promise. */
  decodeAudioData = (_b: ArrayBuffer, ok: (b: unknown) => void, fail: (e: unknown) => void) => {
    audio.decodes++;
    if (audio.decode === 'hang') return new Promise(() => {});
    if (audio.decode === 'fail') {
      const e = new Error('bad mp3');
      fail(e);
      return Promise.reject(e);
    }
    const buf = { duration: 1.8 };
    ok(buf);
    return Promise.resolve(buf);
  };
  resume = () => Promise.resolve();
}

/** The cheer's bytes, optionally after a delay (ms) or never (`Infinity`). */
export function cheerResponse(delayMs = 0, status = 200) {
  const res = { ok: status < 400, status, arrayBuffer: async () => new ArrayBuffer(8) };
  if (delayMs === Infinity) return new Promise(() => {});
  return delayMs ? new Promise((r) => setTimeout(() => r(res), delayMs)) : Promise.resolve(res);
}
