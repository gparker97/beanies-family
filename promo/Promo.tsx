import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { COLORS, VIDEO } from './brand';
import { ART } from './assets';
import { Phone } from './Phone';
import { RichText } from './RichText';

const outfit = loadOutfit().fontFamily;
const inter = loadInter().fontFamily;

const SECONDS = (s: number) => Math.round(s * VIDEO.fps);

export const INTRO_FRAMES = SECONDS(3.4);
export const SCENE_FRAMES = SECONDS(4.2);
export const OUTRO_FRAMES = SECONDS(4.5);
/** Cross-fade length. Scenes overlap by this much at each boundary. */
const FADE = SECONDS(0.5);

/**
 * Copy is greg's, verbatim, with two typo fixes ("stuf" -> "stuff",
 * "previous moments" -> "precious moments"). Inline markup per `RichText`:
 * `**orange bold**` for the key idea, `*italic*` for tone.
 *
 * A scene with no `src` is a statement scene: no phone, brand art instead.
 * The privacy beat is one of these because the app has no screen that shows the
 * promise — the Family Data drawer renders its "resume setup" state under the
 * demo's in-memory provider. See the note in scripts/store-screenshots/capture.ts.
 */
type Scene = {
  src?: string;
  headline: string;
  sub: string;
  /** Optional pill that points back at the phone. Keep to at most one per video. */
  callout?: string;
};

const SCENES: Scene[] = [
  {
    src: '01-nook.png',
    headline: 'all your little beans, **together in one friendly place**',
    sub: 'your family nook pulls today together: **no more worrying** about what is on, what needs to get done, or who is doing it',
  },
  {
    src: '02-planner.png',
    headline: 'one calendar, **shared with everyone**',
    sub: 'your lessons, appointments, dinners, travel plans, and anything else. no more asking *whose turn it is* to pick up joey.',
  },
  {
    src: '03-todos.png',
    headline: 'share the load and **get stuff done**',
    sub: 'assign a task, tick it off, and watch the beanies **celebrate**.',
    callout: 'tick it off',
  },
  {
    src: '04-money.png',
    headline: 'know **where you stand**',
    sub: 'track your accounts, spending, budget, goals, and your actual net worth - together and **fully private**.',
  },
  {
    src: '05-meet-the-beans.png',
    headline: 'everything you need to know about **your beanies**',
    sub: 'track their favorite foods, medications, even keep a scrapbook to preserve those *precious* moments. every bean gets a place, and **your data stays yours**.',
  },
  {
    headline: 'fully secure, and fully private - **guaranteed**',
    sub: 'your data is fully encrypted and stays with you. beanies *never* stores your data - so you can focus on your family.',
  },
];

const STEP = SCENE_FRAMES - FADE;
const SCENES_START = INTRO_FRAMES - FADE;
const OUTRO_START = SCENES_START + SCENES.length * STEP;
export const TOTAL_FRAMES = OUTRO_START + OUTRO_FRAMES;

/** Fade in over the first FADE frames, out over the last. */
function fadeOpacity(local: number, length: number): number {
  return Math.min(
    interpolate(local, [0, FADE], [0, 1], { extrapolateRight: 'clamp' }),
    interpolate(local, [length - FADE, length], [1, 0], { extrapolateLeft: 'clamp' })
  );
}

/**
 * Staggered reveal: each element fades up a beat after the one above it, so the
 * eye is led down the caption rather than hit with the whole block at once.
 */
function reveal(local: number, delaySeconds: number): React.CSSProperties {
  const start = SECONDS(delaySeconds);
  const t = interpolate(local, [start, start + SECONDS(0.55)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return { opacity: t, transform: `translateY(${(1 - t) * 22}px)` };
}

/** Wordmark with the `.family` in Heritage Orange, per the CIG. */
const Wordmark: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ fontFamily: outfit, fontWeight: 700, fontSize: size, lineHeight: 1 }}>
    <span style={{ color: COLORS.deepSlate }}>beanies</span>
    <span style={{ color: COLORS.heritageOrange }}>.family</span>
  </div>
);

/** The tagline is always lowercase and always italic here, per greg. */
const Tagline: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      fontFamily: inter,
      fontStyle: 'italic',
      fontSize: size,
      color: COLORS.heritageOrange,
    }}
  >
    every bean counts
  </div>
);

/**
 * Persistent brand mark on every scene (never the bookends, where the wordmark is
 * already the hero). It sits on the CAPTION side: parked bottom-right on a
 * right-phone scene it clips the bezel.
 */
const Watermark: React.FC<{ side: 'left' | 'right' }> = ({ side }) => (
  <div
    style={{
      position: 'absolute',
      [side]: 56,
      bottom: 44,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      opacity: 0.55,
    }}
  >
    <Img src={ART.logo} style={{ width: 40, height: 40 }} />
    <div style={{ fontFamily: outfit, fontWeight: 600, fontSize: 26 }}>
      <span style={{ color: COLORS.deepSlate }}>beanies</span>
      <span style={{ color: COLORS.heritageOrange }}>.family</span>
    </div>
  </div>
);

/**
 * A pill with a stub arrow pointing back at the phone. `side` is the side of the
 * phone column the pill sits on, so the arrow always points inward at the device.
 */
const Callout: React.FC<{ text: string; local: number; side: 'left' | 'right' }> = ({
  text,
  local,
  side,
}) => (
  <div
    style={{
      ...reveal(local, 1.5),
      position: 'absolute',
      top: '52%',
      [side]: 24,
      display: 'flex',
      // Arrow must sit between the pill and the phone.
      flexDirection: side === 'right' ? 'row-reverse' : 'row',
      alignItems: 'center',
      gap: 10,
    }}
  >
    <div
      style={{
        fontFamily: outfit,
        fontWeight: 600,
        fontSize: 24,
        color: COLORS.cloudWhite,
        background: COLORS.heritageOrange,
        padding: '10px 22px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        boxShadow: '0 8px 20px rgba(241, 93, 34, 0.28)',
      }}
    >
      {text}
    </div>
    <div style={{ width: 48, height: 3, borderRadius: 999, background: COLORS.heritageOrange }} />
  </div>
);

const Caption: React.FC<{ scene: Scene; local: number; centered?: boolean }> = ({
  scene,
  local,
  centered = false,
}) => (
  <div style={{ maxWidth: centered ? 1100 : 640, textAlign: centered ? 'center' : 'left' }}>
    <h1
      style={{
        ...reveal(local, 0.15),
        fontFamily: outfit,
        fontWeight: 700,
        fontSize: centered ? 76 : 62,
        lineHeight: 1.12,
        color: COLORS.deepSlate,
        margin: 0,
      }}
    >
      <RichText>{scene.headline}</RichText>
    </h1>
    <p
      style={{
        ...reveal(local, 0.55),
        fontFamily: inter,
        fontWeight: 400,
        fontSize: centered ? 34 : 29,
        lineHeight: 1.55,
        color: COLORS.deepSlate,
        marginTop: 26,
        // Multiply, never assign: a constant here would clobber reveal()'s fade-in.
        opacity: (reveal(local, 0.55).opacity as number) * 0.88,
      }}
    >
      <RichText>{scene.sub}</RichText>
    </p>
  </div>
);

const Intro: React.FC<{ local: number; length: number }> = ({ local, length }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: local, fps, config: { damping: 14, mass: 0.7 } });

  return (
    <AbsoluteFill style={{ opacity: fadeOpacity(local, length) }}>
      {/* Decorative screens, tilted and set back. Never the focus. */}
      <Img
        src={staticFile('01-nook.png')}
        style={{
          position: 'absolute',
          left: -110,
          top: 120,
          width: 330,
          borderRadius: 28,
          opacity: 0.28,
          transform: 'rotate(-9deg)',
          boxShadow: '0 30px 60px rgba(44,62,80,0.10)',
        }}
      />
      <Img
        src={staticFile('02-planner.png')}
        style={{
          position: 'absolute',
          right: -110,
          bottom: 90,
          width: 330,
          borderRadius: 28,
          opacity: 0.28,
          transform: 'rotate(8deg)',
          boxShadow: '0 30px 60px rgba(44,62,80,0.10)',
        }}
      />

      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 22 }}
      >
        <Img
          src={ART.hugging}
          style={{ width: 300, height: 300, transform: `scale(${0.85 + pop * 0.15})` }}
        />
        <div style={reveal(local, 0.5)}>
          <Wordmark size={104} />
        </div>
        <div style={reveal(local, 0.9)}>
          <Tagline size={40} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ local: number; length: number }> = ({ local, length }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: local, fps, config: { damping: 14, mass: 0.7 } });

  return (
    <AbsoluteFill
      style={{
        opacity: fadeOpacity(local, length),
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <Img
        src={ART.hugging}
        style={{ width: 330, height: 330, transform: `scale(${0.85 + pop * 0.15})` }}
      />
      <div style={reveal(local, 0.45)}>
        <Wordmark size={88} />
      </div>
      <div style={reveal(local, 0.8)}>
        <Tagline size={38} />
      </div>
      <div
        style={{
          ...reveal(local, 1.25),
          fontFamily: inter,
          fontWeight: 500,
          fontSize: 32,
          color: COLORS.cloudWhite,
          background: COLORS.heritageOrange,
          padding: '18px 46px',
          borderRadius: 999,
          marginTop: 10,
          boxShadow: '0 14px 34px rgba(241, 93, 34, 0.32)',
        }}
      >
        fully private and secure
      </div>
      <Img src={ART.celebrating} style={{ ...reveal(local, 1.7), width: 460, marginTop: 8 }} />
    </AbsoluteFill>
  );
};

/** The privacy beat: brand art carrying the promise, no phone. */
const Statement: React.FC<{ scene: Scene; local: number }> = ({ scene, local }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: local, fps, config: { damping: 16, mass: 0.8 } });

  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 30 }}
    >
      <div style={{ position: 'relative', transform: `scale(${0.9 + pop * 0.1})` }}>
        <Img src={ART.hugging} style={{ width: 260, height: 260 }} />
        <div
          style={{
            position: 'absolute',
            right: -54,
            bottom: 18,
            width: 92,
            height: 92,
            borderRadius: 999,
            background: COLORS.heritageOrange,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 46,
            boxShadow: '0 12px 28px rgba(241, 93, 34, 0.35)',
          }}
        >
          🔒
        </div>
      </div>
      <Caption scene={scene} local={local} centered />
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.cloudWhite }}>
      {/* Warm wash so the Cloud White backdrop is not clinical. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 72% 30%, ${COLORS.skySilk}55, transparent 60%)`,
        }}
      />

      {frame < INTRO_FRAMES ? <Intro local={frame} length={INTRO_FRAMES} /> : null}

      {SCENES.map((scene, i) => {
        const local = frame - (SCENES_START + i * STEP);
        if (local < 0 || local > SCENE_FRAMES) return null;

        if (!scene.src) {
          return (
            <AbsoluteFill
              key={scene.headline}
              style={{ opacity: fadeOpacity(local, SCENE_FRAMES) }}
            >
              <Statement scene={scene} local={local} />
            </AbsoluteFill>
          );
        }

        // Alternate sides so the eye moves. Even scenes: phone left.
        const phoneLeft = i % 2 === 0;

        return (
          <AbsoluteFill
            key={scene.src}
            style={{
              opacity: fadeOpacity(local, SCENE_FRAMES),
              flexDirection: phoneLeft ? 'row' : 'row-reverse',
              // Columns must STRETCH, not center: centering shrinks each flex
              // child to its content height, leaving the Phone's AbsoluteFill
              // nothing to fill (it collapsed to a flat bar). The caption does
              // its own vertical centering below.
              alignItems: 'stretch',
            }}
          >
            <div style={{ flex: 1, position: 'relative' }}>
              <Phone src={scene.src} progress={local / SCENE_FRAMES} />
              {scene.callout ? (
                <Callout text={scene.callout} local={local} side={phoneLeft ? 'right' : 'left'} />
              ) : null}
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: phoneLeft ? 'flex-start' : 'flex-end',
                paddingLeft: phoneLeft ? 0 : 110,
                paddingRight: phoneLeft ? 110 : 0,
              }}
            >
              <Caption scene={scene} local={local} />
            </div>
            <Watermark side={phoneLeft ? 'right' : 'left'} />
          </AbsoluteFill>
        );
      })}

      {frame >= OUTRO_START ? <Outro local={frame - OUTRO_START} length={OUTRO_FRAMES} /> : null}
    </AbsoluteFill>
  );
};
