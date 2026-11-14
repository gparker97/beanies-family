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
import { raceTimeout } from '@/utils/timing';
import { failureBackoff } from '@/utils/backoff';

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
/** A load still unsettled after this is forgotten (never cached forever) and counts as failed. */
const ENGINE_LOAD_DEADLINE_MS = 15_000;

type CelebrationEngine = typeof import('@/composables/choreCelebrationSounds');
const importEngine = () => import('@/composables/choreCelebrationSounds');
/** How the engine is fetched: the dynamic import (tests swap in a hung or failing one). */
let fetchEngine: () => Promise<CelebrationEngine> = importEngine;
let engine: Promise<CelebrationEngine> | null = null;
const engineBackoff = failureBackoff();
/** The latest celebration's turn: an older (or dismissed) one's sound never starts. */
let latestCelebration = 0;

function engineFailed(error: unknown, stage: 'import' | 'stalled'): void {
  if (!engineBackoff.fail()) return;
  reportError({
    surface: 'sounds',
    message: 'the celebration sound engine could not load; the fanfare plays until it does',
    severity: 'warning',
    error,
    context: { action: 'engine-load', stage },
  });
}

/**
 * Load the engine once and keep it. A failed or stalled load is forgotten and retried on the
 * shared backoff ladder (reported once per failure episode); while it backs off, this rejects
 * at once without trying.
 */
export function loadCelebrationSoundEngine(): Promise<CelebrationEngine> {
  if (engine) return engine;
  if (!engineBackoff.ready()) {
    return Promise.reject(new Error('celebration sound engine: waiting to retry'));
  }
  const attempt = fetchEngine();
  engine = attempt;
  const stalled = setTimeout(() => {
    if (engine !== attempt) return;
    engine = null;
    engineFailed(new Error('celebration sound engine load stalled'), 'stalled');
  }, ENGINE_LOAD_DEADLINE_MS);
  attempt.then(
    () => {
      clearTimeout(stalled);
      if (engine === attempt) engineBackoff.succeed();
    },
    (error: unknown) => {
      clearTimeout(stalled);
      if (engine !== attempt) return;
      engine = null;
      engineFailed(error, 'import');
    }
  );
  return attempt;
}

/**
 * The engine's outcomes, plus the fanfare fallbacks (the engine was still loading at the cutoff:
 * `fanfare-late`; it could not load or is backing off: `fanfare-failed`) and `unavailable` (no
 * Web Audio here).
 */
export type CelebrationSoundOutcome =
  EngineSoundOutcome | 'fanfare-late' | 'fanfare-failed' | 'unavailable';

/**
 * Play a chore celebration sound, on time or not at all: whatever starts, starts within
 * `CELEBRATION_SOUND_CUTOFF_MS` of the tap. The cheer loads on its first need (never at app
 * start); a newer celebration, or this one's dismissal (`cancelChoreCelebrationSound`), stops it
 * from starting; turning sound off while it waits silences it.
 */
export async function playChoreCelebrationSound(
  id: ChoreSoundId,
  fallback: SynthCelebrationSoundId
): Promise<CelebrationSoundOutcome> {
  if (!enabled) return 'muted';
  const ctx = getContext();
  if (!ctx) return 'unavailable';
  const turn = ++latestCelebration;
  const deadline = performance.now() + CELEBRATION_SOUND_CUTOFF_MS;
  const gate = {
    enabled: () => enabled,
    current: () => turn === latestCelebration,
    deadline,
  };
  let loaded: CelebrationEngine | undefined | 'failed';
  try {
    loaded = await raceTimeout(loadCelebrationSoundEngine(), deadline - performance.now());
  } catch {
    // Reported once per failure episode by `loadCelebrationSoundEngine`.
    loaded = 'failed';
  }
  if (!gate.enabled()) return 'muted';
  if (!gate.current()) return 'superseded';
  if (!loaded || loaded === 'failed') {
    playFanfare();
    return loaded ? 'fanfare-failed' : 'fanfare-late';
  }
  return loaded.playCelebrationSound(ctx, id, fallback, gate);
}

/** The celebration ended: a sound still waiting to start (the cheer loading) never starts. */
export function cancelChoreCelebrationSound(): void {
  latestCelebration++;
}

/**
 * Tests only: forget the context, the engine, its backoff and the turn; optionally load the
 * engine some other way (a hung or failing load), else the real dynamic import.
 */
export function resetCelebrationSoundsForTest(load?: () => Promise<CelebrationEngine>): void {
  fetchEngine = load ?? importEngine;
  engine = null;
  engineBackoff.succeed();
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
