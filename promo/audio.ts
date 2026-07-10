/**
 * Soundtrack level, as a function of frame.
 *
 * The supplied track is a flat bed: its RMS sits between -15.2 and -16.4 dB from
 * end to end, with no build anywhere. So the swell greg asked for cannot come
 * from the arrangement — there isn't one. It is synthesised here instead, which
 * is the better outcome anyway: the lift lands exactly on the outro pill and the
 * celebrating beanies rather than wherever the music happened to peak.
 *
 * Kept pure and separate from `Promo.tsx` so the curve can be reasoned about
 * without rendering a thousand frames to hear it.
 */
import { interpolate, Easing } from 'remotion';

const EASE = Easing.inOut(Easing.cubic);

/** Steady level under the scenes. Low enough to sit behind, not compete. */
const BED = 0.5;
/** Peak across the outro. Pushed higher, the mp3's own limiting starts to pump. */
const LIFT = 0.82;

export type MusicBeats = {
  introFrames: number;
  outroStart: number;
  totalFrames: number;
  fps: number;
};

export function musicVolume(frame: number, beats: MusicBeats): number {
  const { introFrames, outroStart, totalFrames, fps } = beats;
  const sec = (s: number) => Math.round(s * fps);

  // Fade up across the intro, from silence — never open on a hard transient.
  if (frame < introFrames) {
    return interpolate(frame, [0, introFrames], [0, BED], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE,
    });
  }

  if (frame < outroStart) return BED;

  // Outro: lift as the beanies and the pill land, then fall away. The fade-out
  // completes ON the final frame, so the render never cuts off mid-note.
  const lift = interpolate(frame, [outroStart, outroStart + sec(2.3)], [BED, LIFT], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  });
  const out = interpolate(frame, [totalFrames - sec(1.6), totalFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  });
  return lift * out;
}
