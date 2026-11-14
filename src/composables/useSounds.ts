/**
 * Sound effects composable — synthesises short sounds via the Web Audio API.
 *
 * State is module-level so all callers share the same AudioContext and
 * enabled flag. The AudioContext is created lazily on the first sound call
 * to respect browser autoplay policies (it must be created in response to
 * a user gesture).
 */
import type { ChoreSoundId, SynthCelebrationSoundId } from '@/utils/choreCelebration';
import type { EngineSoundOutcome } from '@/composables/choreCelebrationSounds';
import { reportError } from '@/utils/errorReporter';
import { withDeadline } from '@/utils/withDeadline';

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
// The engine (seven synthesized sounds, the kids cheer, their output chain) is code-split into
// `choreCelebrationSounds.ts`; this keeps the one audio context, the mute gate and the timing.

/** No celebration sound may START later than this after the tap. */
export const CELEBRATION_SOUND_CUTOFF_MS = 400;

type CelebrationEngine = typeof import('@/composables/choreCelebrationSounds');
let engine: Promise<CelebrationEngine> | null = null;
let engineFailureReported = false;
/** The latest celebration's token: an older one's sound never starts. */
let latestCelebration = 0;

/** Load the engine once (a failed load is forgotten so the next need retries). */
export function loadCelebrationSoundEngine(): Promise<CelebrationEngine> {
  engine ??= import('@/composables/choreCelebrationSounds').catch((e: unknown) => {
    engine = null;
    throw e;
  });
  return engine;
}

/**
 * The engine's outcomes, plus `fanfare` (the engine was not loaded within the cutoff, so the
 * everyday fanfare played instead) and `unavailable` (no Web Audio here).
 */
export type CelebrationSoundOutcome = EngineSoundOutcome | 'fanfare' | 'unavailable';

/**
 * Play a chore celebration sound, on time or not at all: whatever starts, starts within
 * `CELEBRATION_SOUND_CUTOFF_MS` of the tap. The cheer loads on its first need (never at app
 * start); a newer celebration supersedes this one; turning sound off while it waits silences it.
 */
export async function playChoreCelebrationSound(
  id: ChoreSoundId,
  fallback: SynthCelebrationSoundId
): Promise<CelebrationSoundOutcome> {
  if (!enabled) return 'muted';
  const ctx = getContext();
  if (!ctx) return 'unavailable';
  const token = ++latestCelebration;
  const gate = {
    enabled: () => enabled,
    current: () => token === latestCelebration,
    deadline: performance.now() + CELEBRATION_SOUND_CUTOFF_MS,
  };
  let loaded: CelebrationEngine | 'late' | 'failed';
  try {
    loaded = await withDeadline(loadCelebrationSoundEngine(), gate.deadline);
  } catch (error) {
    loaded = 'failed';
    if (!engineFailureReported) {
      engineFailureReported = true;
      reportError({
        surface: 'sounds',
        message: 'the celebration sound engine could not load; the fanfare played instead',
        severity: 'warning',
        error,
        context: { action: 'engine-load' },
      });
    }
  }
  if (!gate.enabled()) return 'muted';
  if (!gate.current()) return 'superseded';
  if (loaded === 'late' || loaded === 'failed') {
    playFanfare();
    return 'fanfare';
  }
  return loaded.playCelebrationSound(ctx, id, fallback, gate);
}

/** Tests only: forget the context, the engine and the token. */
export function resetCelebrationSoundsForTest(): void {
  engine = null;
  engineFailureReported = false;
  latestCelebration = 0;
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
