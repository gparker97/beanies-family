/**
 * Sound effects composable — synthesises short sounds via the Web Audio API.
 *
 * State is module-level so all callers share the same AudioContext and
 * enabled flag. The AudioContext is created lazily on the first sound call
 * to respect browser autoplay policies (it must be created in response to
 * a user gesture).
 */
import {
  CELEBRATION_SOUNDS,
  eventPeaks,
  noteHz,
  type CelebrationVoice,
} from '@/constants/celebrationSounds';
import {
  CHEER_SOUND,
  type ChoreSoundId,
  type SynthCelebrationSoundId,
} from '@/utils/choreCelebration';
import { reportError } from '@/utils/errorReporter';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------
let audioCtx: AudioContext | null = null;
let enabled = true;

function getContext(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      // Web Audio API not available (e.g. SSR, test env)
      return null;
    }
  }
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// ---------------------------------------------------------------------------
// Sound definitions
// ---------------------------------------------------------------------------

/** Short sine-wave pitch-bend — item created / general positive action. */
export function playPop(): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
}

/** Two quick sine tones — success / confirmation. */
export function playClink(): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(i === 0 ? 800 : 1200, ctx.currentTime + i * 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.1);
    osc.stop(ctx.currentTime + i * 0.1 + 0.12);
  }
}

/** Ascending three-note chord — celebration toast. */
export function playChime(): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  const notes = [523, 659, 784]; // C5, E5, G5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
    gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.1);
    osc.stop(ctx.currentTime + i * 0.1 + 0.3);
  });
}

/** Longer ascending arpeggio — celebration modal / big achievement. */
export function playFanfare(): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
    gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.12);
    osc.stop(ctx.currentTime + i * 0.12 + 0.4);
  });
}

/** Filtered noise sweep — delete / dismiss. */
export function playWhoosh(): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  // Use a sawtooth oscillator with rapid frequency drop to simulate a whoosh
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.2);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.2);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.25);
}

/** Very short click — privacy toggle / quick UI feedback. */
export function playBlink(): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1000, ctx.currentTime);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.05);
}

// ---------------------------------------------------------------------------
// The chore celebration's sounds (#146)
// ---------------------------------------------------------------------------
//
// Seven synthesized sounds (the data lives in `constants/celebrationSounds.ts`) and the owner's
// recording of children cheering, all through ONE output chain: a soft room reverb into a bus,
// a gentle top-end roll-off (so bells and glockenspiel never shriek on a phone or tablet
// speaker) and a compressor. Ported from the approved v4 mockup with its "raised" timbre
// softening baked in. The other sounds above keep their direct path, unchanged.

/** The shared output chain for one audio context. */
export interface CelebrationChain {
  ctx: BaseAudioContext;
  /** Everything dry and wet meets here. */
  bus: GainNode;
  verb: ConvolverNode;
  /** The compressor: the chain's last node before the speakers (the cheer goes straight in). */
  post: DynamicsCompressorNode;
  /** Two seconds of white noise, for the kazoo's buzz. */
  noise: AudioBuffer;
}

let chain: CelebrationChain | null = null;

/** A decaying stereo noise burst: the reverb's impulse response. */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return ir;
}

/** Build the chain on `ctx` (exported so an offline render can measure a sound's level). */
export function buildCelebrationChain(ctx: BaseAudioContext): CelebrationChain {
  const bus = ctx.createGain();
  bus.gain.value = 0.9;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.5;
  tone.frequency.value = 6000;
  const post = ctx.createDynamicsCompressor();
  post.threshold.value = -14;
  post.ratio.value = 4;
  bus.connect(tone).connect(post).connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 1.6, 3);
  const verbReturn = ctx.createGain();
  verbReturn.gain.value = 0.28;
  verb.connect(verbReturn).connect(bus);
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return { ctx, bus, verb, post, noise };
}

function celebrationChain(): CelebrationChain | null {
  const ctx = getContext();
  if (!ctx) return null;
  if (!chain || chain.ctx !== ctx) chain = buildCelebrationChain(ctx);
  return chain;
}

// ── The voices: each plays one note of a sound's table ──────────────────────

function envelope(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function osc(
  c: CelebrationChain,
  type: OscillatorType,
  f: number,
  t: number,
  end: number,
  detune = 0
): OscillatorNode {
  const o = c.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.detune.value = detune;
  o.start(t);
  o.stop(end);
  return o;
}

/** Dry into the bus, plus `wet` of it into the room. */
function send(c: CelebrationChain, node: AudioNode, wet: number): void {
  node.connect(c.bus);
  if (wet > 0) {
    const g = c.ctx.createGain();
    g.gain.value = wet;
    node.connect(g).connect(c.verb);
  }
}

function gainNode(c: CelebrationChain): GainNode {
  return c.ctx.createGain();
}

type VoiceFn = (c: CelebrationChain, f: number, t: number, peak: number, dur: number) => void;

const VOICES: Record<CelebrationVoice, VoiceFn> = {
  /** A plucked string: saw + triangle through a closing low-pass. `dur` is the decay. */
  pluck(c, f, t, peak, decay) {
    const g = gainNode(c);
    const lp = c.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, 600), t + decay * 0.6);
    envelope(g, t, peak, 0.004, decay);
    const end = t + decay + 0.1;
    osc(c, 'sawtooth', f, t, end).connect(lp);
    osc(c, 'triangle', f, t, end).connect(lp);
    lp.connect(g);
    send(c, g, 0.18);
  },
  /** A wooden bar: a sine with two soft, fast-fading overtones. */
  marimba(c, f, t, peak) {
    const decay = 0.6 * Math.pow(523 / f, 0.3) * 1.15;
    const end = t + decay + 0.05;
    const g = gainNode(c);
    envelope(g, t, peak, 0.003, decay);
    osc(c, 'sine', f, t, end).connect(g);
    send(c, g, 0.15);
    const g2 = gainNode(c);
    envelope(g2, t, peak * 0.3 * 0.45, 0.002, 0.09);
    osc(c, 'sine', f * 3.93, t, end).connect(g2);
    send(c, g2, 0.1);
    const g3 = gainNode(c);
    envelope(g3, t, peak * 0.12 * 0.45, 0.001, 0.025);
    osc(c, 'sine', f * 9.2, t, end).connect(g3);
    send(c, g3, 0);
  },
  /** A bell: FM with a softened, faster-closing modulator. */
  bell(c, f, t, peak, dur) {
    const end = t + dur + 0.05;
    const car = osc(c, 'sine', f, t, end);
    const mod = osc(c, 'sine', f * 3.5, t, end);
    const mg = gainNode(c);
    mg.gain.setValueAtTime(f * 0.9, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.01, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = gainNode(c);
    envelope(g, t, peak, 0.003, dur);
    car.connect(g);
    send(c, g, 0.38);
    const g2 = gainNode(c);
    envelope(g2, t, peak * 0.15, 0.003, dur * 0.4);
    osc(c, 'sine', f * 2, t, end).connect(g2);
    send(c, g2, 0.3);
  },
  /** A glockenspiel: a sine with two quieter, shorter metal partials. */
  glock(c, f, t, peak, dur) {
    const end = t + dur + 0.05;
    const g = gainNode(c);
    envelope(g, t, peak, 0.002, dur);
    osc(c, 'sine', f, t, end).connect(g);
    send(c, g, 0.4);
    const g2 = gainNode(c);
    envelope(g2, t, peak * 0.32 * 0.5, 0.002, dur * 0.35 * 0.5);
    osc(c, 'sine', f * 2.76, t, end).connect(g2);
    send(c, g2, 0.35);
    const g3 = gainNode(c);
    envelope(g3, t, peak * 0.12 * 0.25, 0.001, dur * 0.12);
    osc(c, 'sine', f * 5.4, t, end).connect(g3);
    send(c, g3, 0.2);
  },
  /**
   * A horn: saw plus square at the same pitch through a brassy filter swell. No detune pair (a
   * beating pair dipped a held top C almost to silence); a held note gets a gentle vibrato.
   */
  brass(c, f, t, peak, dur) {
    const end = t + dur + 0.2;
    const lp = c.ctx.createBiquadFilter();
    const g = gainNode(c);
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(560, t);
    lp.frequency.linearRampToValueAtTime(4480, t + 0.04);
    lp.frequency.setTargetAtTime(2400, t + 0.05, 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak, t + Math.max(0.04, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    const a = osc(c, 'sawtooth', f, t, end);
    const b = osc(c, 'square', f, t, end);
    if (dur > 0.4) {
      const lfo = osc(c, 'sine', 5.5, t + 0.25, end);
      const lg = gainNode(c);
      lg.gain.value = 12;
      lfo.connect(lg);
      lg.connect(a.detune);
      lg.connect(b.detune);
    }
    a.connect(lp);
    b.connect(lp);
    lp.connect(g);
    send(c, g, 0.22);
  },
  /** A pizzicato string: triangle + saw through a fast-closing filter. */
  pizz(c, f, t, peak) {
    const decay = f < 150 ? 0.55 : 0.38;
    const end = t + decay + 0.05;
    const lp = c.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(Math.min(6000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, 180), t + 0.12);
    const g = gainNode(c);
    envelope(g, t, peak, 0.003, decay);
    osc(c, 'triangle', f, t, end).connect(lp);
    osc(c, 'sawtooth', f, t, end).connect(lp);
    lp.connect(g);
    send(c, g, 0.3);
  },
  /** A kazoo: a wobbling saw through two vowel bands, with a little buzz. */
  kazoo(c, f, t, peak, dur) {
    const end = t + dur + 0.12;
    const s = osc(c, 'sawtooth', f, t, end);
    const lfo = osc(c, 'sine', 6.2, t, end);
    const lg = gainNode(c);
    lg.gain.value = 16;
    lfo.connect(lg).connect(s.detune);
    const g = gainNode(c);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.02);
    g.gain.setValueAtTime(peak, t + Math.max(0.03, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    for (const [fc, q, lv] of [
      [1305, 1.6, 1],
      [3335, 2.2, 0.55],
    ] as const) {
      const bp = c.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fc;
      bp.Q.value = q;
      const lvg = gainNode(c);
      lvg.gain.value = lv * 2.2;
      s.connect(bp).connect(lvg).connect(g);
    }
    const buzz = c.ctx.createBiquadFilter();
    buzz.type = 'bandpass';
    buzz.frequency.value = 3200;
    buzz.Q.value = 3;
    const bg = gainNode(c);
    bg.gain.value = 0.25;
    const n = c.ctx.createBufferSource();
    n.buffer = c.noise;
    n.loop = true;
    n.start(t, 0);
    n.stop(t + dur + 0.1);
    n.connect(buzz).connect(bg).connect(g);
    send(c, g, 0.2);
  },
};

/** Schedule one synthesized celebration sound on `c`, `delay` seconds from now. */
export function scheduleCelebrationSound(
  c: CelebrationChain,
  id: SynthCelebrationSoundId,
  delay = 0
): void {
  const def = CELEBRATION_SOUNDS[id];
  const t0 = c.ctx.currentTime + 0.02 + delay;
  for (const e of def.events) {
    const peaks = eventPeaks(e);
    e.notes.forEach((note, i) => {
      VOICES[e.voice](
        c,
        noteHz(note),
        t0 + e.at + i * (e.step ?? 0),
        peaks[i]! * def.level,
        e.dur ?? 0
      );
    });
  }
}

// ── The kids cheer (the owner's recording) ──────────────────────────────────

/** Precached by the service worker and copied into the native builds with the rest of `dist`. */
export const CHEER_URL = `${import.meta.env.BASE_URL}sounds/kids-cheer.mp3`;
/**
 * The cheer's level into the compressor. The file is already loudness-matched to the synthesized
 * sounds (the same measured RMS as the mockup's), so this is unity; the swell below shapes it.
 */
const CHEER_GAIN = 1;

let cheerBuffer: { ctx: BaseAudioContext; buffer: Promise<AudioBuffer> } | null = null;
let cheerFailureReported = false;

class CheerLoadError extends Error {
  readonly stage: 'fetch' | 'decode';
  readonly httpStatus: number | undefined;
  constructor(stage: 'fetch' | 'decode', httpStatus: number | undefined, cause: unknown) {
    super(`kids cheer ${stage} failed`, { cause });
    this.stage = stage;
    this.httpStatus = httpStatus;
  }
}

/** Fetch and decode the cheer once per audio context (callback form: Safari accepts only it). */
export function loadCheer(ctx: BaseAudioContext): Promise<AudioBuffer> {
  if (cheerBuffer?.ctx === ctx) return cheerBuffer.buffer;
  const buffer = fetch(CHEER_URL)
    .catch((e: unknown) => {
      throw new CheerLoadError('fetch', undefined, e);
    })
    .then((res) => {
      if (!res.ok) throw new CheerLoadError('fetch', res.status, null);
      return res.arrayBuffer();
    })
    .then(
      (bytes) =>
        new Promise<AudioBuffer>((resolve, reject) => {
          ctx.decodeAudioData(bytes, resolve, (e) =>
            reject(new CheerLoadError('decode', undefined, e))
          );
        })
    );
  cheerBuffer = { ctx, buffer };
  // A failure is not cached: a later celebration (back online, say) tries again.
  buffer.catch(() => {
    if (cheerBuffer?.buffer === buffer) cheerBuffer = null;
  });
  return buffer;
}

/** Play the cheer through the chain: a little over half strength on the tick, full by 0.9 s. */
function startCheer(c: CelebrationChain, buffer: AudioBuffer, from: number): void {
  const t = Math.max(c.ctx.currentTime, from) + 0.02;
  const src = c.ctx.createBufferSource();
  const g = gainNode(c);
  src.buffer = buffer;
  g.gain.setValueAtTime(CHEER_GAIN * 0.6, t);
  g.gain.linearRampToValueAtTime(CHEER_GAIN, t + 0.9);
  src.connect(g).connect(c.post);
  src.start(t);
}

function reportCheerFailure(err: unknown): void {
  if (cheerFailureReported) return;
  cheerFailureReported = true;
  const e = err instanceof CheerLoadError ? err : null;
  reportError({
    surface: 'sounds',
    message: 'the kids cheer could not be loaded; the paired celebration sound played instead',
    severity: 'warning',
    error: err,
    context: {
      action: 'cheer-load',
      stage: e?.stage ?? 'unknown',
      ...(e?.httpStatus !== undefined ? { http_status: e.httpStatus } : {}),
    },
  });
}

/**
 * - `played`: the requested sound is playing (or will, once the cheer has decoded);
 * - `fallback`: the cheer could not load, so `fallback` played instead;
 * - `muted`: sound is off in Settings;
 * - `unavailable`: no Web Audio here.
 */
export type CelebrationSoundOutcome = 'played' | 'fallback' | 'muted' | 'unavailable';

/**
 * Play a chore celebration sound. The cheer loads on its first need (never at app start), then
 * stays decoded in memory; if it cannot load, the move's paired synthesized sound plays instead.
 */
export async function playChoreCelebrationSound(
  id: ChoreSoundId,
  fallback: SynthCelebrationSoundId
): Promise<CelebrationSoundOutcome> {
  if (!enabled) return 'muted';
  const c = celebrationChain();
  if (!c) return 'unavailable';
  if (id !== CHEER_SOUND) {
    scheduleCelebrationSound(c, id);
    return 'played';
  }
  const tapped = c.ctx.currentTime;
  try {
    startCheer(c, await loadCheer(c.ctx), tapped);
    return 'played';
  } catch (err) {
    reportCheerFailure(err);
    scheduleCelebrationSound(c, fallback);
    return 'fallback';
  }
}

/** Tests only: forget the chain, the decoded cheer and the once-only failure report. */
export function resetCelebrationSoundsForTest(): void {
  chain = null;
  cheerBuffer = null;
  cheerFailureReported = false;
  audioCtx = null;
}

// ---------------------------------------------------------------------------
// Control API
// ---------------------------------------------------------------------------

/**
 * Called from App.vue watcher to keep enabled flag in sync with settings.
 */
export function setSoundEnabled(val: boolean): void {
  enabled = val;
}

/**
 * Returns current enabled state — mainly useful for tests.
 */
export function isSoundEnabled(): boolean {
  return enabled;
}

/**
 * Composable entry point. Returns all sound functions for use in components.
 */
export function useSounds() {
  return {
    playPop,
    playClink,
    playChime,
    playFanfare,
    playWhoosh,
    playBlink,
    setSoundEnabled,
    isSoundEnabled,
  };
}
