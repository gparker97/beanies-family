import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { COLORS, VIDEO } from './brand';
import { Phone } from './Phone';

const outfit = loadOutfit().fontFamily;
const inter = loadInter().fontFamily;

const SECONDS = (s: number) => Math.round(s * VIDEO.fps);

export const INTRO_FRAMES = SECONDS(2);
export const SCENE_FRAMES = SECONDS(4);
export const OUTRO_FRAMES = SECONDS(2.5);
/** Cross-fade length. Scenes overlap by this much at each boundary. */
const FADE = SECONDS(0.5);

/**
 * COPY IS A DRAFT — greg to review before this ships anywhere public.
 *
 * Sentence case, no Title Case, no em-dashes. The tagline is rendered verbatim
 * per the brand rules ("every bean counts", always lowercase).
 */
const SCENES: { src: string; headline: string; sub: string }[] = [
  {
    src: '01-nook.png',
    headline: 'your family, in one place',
    sub: 'the nook pulls today together: what is on, who is doing it, what needs doing.',
  },
  {
    src: '02-planner.png',
    headline: 'one calendar, everyone on it',
    sub: 'lessons, appointments, dinners. no more asking whose turn it is.',
  },
  {
    src: '03-todos.png',
    headline: 'share the load',
    sub: 'assign a task to a bean, tick it off, watch the family cheer.',
  },
  {
    src: '04-money.png',
    headline: 'know where you stand',
    sub: 'accounts, spending and net worth, together and private.',
  },
  {
    src: '05-meet-the-beans.png',
    headline: 'the whole family, together',
    sub: 'every bean gets a place. the data stays yours.',
  },
];

export const TOTAL_FRAMES =
  INTRO_FRAMES + SCENES.length * SCENE_FRAMES + OUTRO_FRAMES - FADE * (SCENES.length + 1);

/** Fade in over the first FADE frames, out over the last. */
function fadeOpacity(local: number, length: number): number {
  return Math.min(
    interpolate(local, [0, FADE], [0, 1], { extrapolateRight: 'clamp' }),
    interpolate(local, [length - FADE, length], [1, 0], { extrapolateLeft: 'clamp' })
  );
}

const Caption: React.FC<{ headline: string; sub: string; local: number }> = ({
  headline,
  sub,
  local,
}) => {
  // Text drifts up a touch as it settles. Subtle; it should not read as motion.
  const lift = interpolate(local, [0, SECONDS(1)], [18, 0], { extrapolateRight: 'clamp' });

  return (
    <div style={{ maxWidth: 620, transform: `translateY(${lift}px)` }}>
      <h1
        style={{
          fontFamily: outfit,
          fontWeight: 700,
          fontSize: 68,
          lineHeight: 1.1,
          color: COLORS.deepSlate,
          margin: 0,
        }}
      >
        {headline}
      </h1>
      <p
        style={{
          fontFamily: inter,
          fontWeight: 400,
          fontSize: 30,
          lineHeight: 1.5,
          color: COLORS.deepSlate,
          opacity: 0.75,
          marginTop: 24,
        }}
      >
        {sub}
      </p>
    </div>
  );
};

const Bookend: React.FC<{ local: number; length: number; children: React.ReactNode }> = ({
  local,
  length,
  children,
}) => (
  <AbsoluteFill
    style={{
      opacity: fadeOpacity(local, length),
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 18,
    }}
  >
    {children}
  </AbsoluteFill>
);

export const Promo: React.FC = () => {
  const frame = useCurrentFrame();

  // Each scene starts FADE frames before the previous one ends, so the
  // cross-fade is a genuine overlap rather than a dip through the backdrop.
  const step = SCENE_FRAMES - FADE;
  const introEnd = INTRO_FRAMES;
  const scenesStart = introEnd - FADE;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.cloudWhite }}>
      {/* Warm wash so the Cloud White backdrop is not clinical. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 72% 30%, ${COLORS.skySilk}55, transparent 60%)`,
        }}
      />

      <Bookend local={frame} length={INTRO_FRAMES}>
        <div style={{ fontFamily: outfit, fontWeight: 700, fontSize: 96, color: COLORS.deepSlate }}>
          beanies.family
        </div>
        <div style={{ fontFamily: inter, fontSize: 36, color: COLORS.heritageOrange }}>
          every bean counts
        </div>
      </Bookend>

      {SCENES.map((scene, i) => {
        const start = scenesStart + i * step;
        const local = frame - start;
        if (local < 0 || local > SCENE_FRAMES) return null;

        return (
          <AbsoluteFill
            key={scene.src}
            style={{
              opacity: fadeOpacity(local, SCENE_FRAMES),
              flexDirection: 'row',
              // Columns must STRETCH, not center: centering shrinks each flex
              // child to its content height, leaving the Phone's AbsoluteFill
              // nothing to fill (it collapsed to a flat bar). The caption does
              // its own vertical centering below.
              alignItems: 'stretch',
            }}
          >
            <div style={{ flex: 1, position: 'relative' }}>
              <Phone src={scene.src} progress={local / SCENE_FRAMES} />
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                paddingRight: 120,
              }}
            >
              <Caption headline={scene.headline} sub={scene.sub} local={local} />
            </div>
          </AbsoluteFill>
        );
      })}

      <Bookend local={frame - (scenesStart + SCENES.length * step)} length={OUTRO_FRAMES}>
        <div style={{ fontFamily: outfit, fontWeight: 700, fontSize: 76, color: COLORS.deepSlate }}>
          beanies.family
        </div>
        <div
          style={{
            fontFamily: inter,
            fontSize: 32,
            color: COLORS.cloudWhite,
            background: COLORS.heritageOrange,
            padding: '16px 40px',
            borderRadius: 999,
          }}
        >
          free, private, and yours
        </div>
      </Bookend>
    </AbsoluteFill>
  );
};
