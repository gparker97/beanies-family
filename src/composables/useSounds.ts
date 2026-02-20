/**
 * Sound effects composable — synthesises short sounds via the Web Audio API.
 *
 * State is module-level so all callers share the same AudioContext and
 * enabled flag. The AudioContext is created lazily on the first sound call
 * to respect browser autoplay policies (it must be created in response to
 * a user gesture).
 */

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
