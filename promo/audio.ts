/**
 * Soundtrack level, as a function of frame.
 *
 * Full level from the very first frame. An intro fade-up sounds like the music
 * wandered in late — the opening seconds read as silence, then something appears.
 * The track starts as the video starts.
 *
 * At the end, a gentle fall to a floor rather than to silence: fading all the way
 * to zero draws attention to the ending, and the last thing the viewer should
 * notice is the beanies, not the mix.
 *
 * Kept pure and separate from `Promo.tsx` so the curve can be reasoned about
 * without rendering a thousand frames to hear it.
 */
import { interpolate, Easing } from 'remotion';

/** Steady level throughout. Low enough to sit behind, loud enough to be there. */
const BED = 0.5;
/** Where the outro fade lands. Audible, just receding. Never zero. */
const FLOOR = 0.3;
/** Length of the closing fall. Long enough to feel like a decision, not a cut. */
const FADE_OUT_SECONDS = 2.5;

export type MusicBeats = {
  totalFrames: number;
  fps: number;
};

export function musicVolume(frame: number, { totalFrames, fps }: MusicBeats): number {
  const fadeFrames = Math.round(FADE_OUT_SECONDS * fps);

  return interpolate(frame, [totalFrames - fadeFrames, totalFrames], [BED, FLOOR], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
}
