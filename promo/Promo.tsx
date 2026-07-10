import React from 'react';
import {
  AbsoluteFill,
  Easing,
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

export const INTRO_FRAMES = SECONDS(3.6);
export const SCENE_FRAMES = SECONDS(5.6);
export const OUTRO_FRAMES = SECONDS(5);
/**
 * Cross-fade length. Scenes overlap by this much, so one never fully clears
 * before the next arrives — that overlap is what makes a cut read as a dissolve
 * rather than a jump.
 */
const FADE = SECONDS(0.9);

/**
 * greg's copy, whittled to the core. A headline plus at most three snippets, so
 * the eye lands, reads, and moves on inside one scene. Markers per `RichText`:
 * `**orange bold**` for the key idea, `*italic*` for tone.
 *
 * Rule of thumb that keeps this readable: a snippet is a phrase, never a
 * sentence. If it needs a comma and a clause, it is two snippets or none.
 *
 * A scene with no `src` is a statement scene: no phone, brand art instead. The
 * privacy beat is one of these because the app has no screen that shows the
 * promise — the Family Data drawer renders its "resume setup" state under the
 * demo's in-memory provider. See the note in scripts/store-screenshots/capture.ts.
 */
type Scene = {
  src?: string;
  headline: string;
  points: string[];
  /** Optional pill that points back at the phone. Keep to at most one per video. */
  callout?: string;
};

const SCENES: Scene[] = [
  {
    src: '01-nook.png',
    headline: 'all your little beans,\n**in one place**',
    points: ["what's on today", 'what needs doing', "who's doing it"],
  },
  {
    src: '02-planner.png',
    headline: 'one calendar,\n**shared with everyone**',
    points: [
      'lessons, dinners, appointments',
      'travel plans, and everything else',
      'no more *whose turn is it?*',
    ],
  },
  {
    src: '03-todos.png',
    headline: 'share the load,\n**get stuff done**',
    points: ['assign it to a bean', 'tick it off', 'watch the beanies **celebrate**'],
    callout: 'tick it off',
  },
  {
    src: '04-money.png',
    headline: 'know **where you stand**',
    points: [
      'accounts, spending, budgets',
      'goals and your real net worth',
      'together, and **fully private**',
    ],
  },
  {
    src: '05-meet-the-beans.png',
    headline: 'everything about\n**your beanies**',
    points: [
      'favorite foods, medications',
      'a scrapbook for *precious* moments',
      'every bean gets a place',
    ],
  },
  {
    headline: 'fully private, **guaranteed**',
    points: [
      'encrypted, and stays with you',
      'beanies *never* stores your data',
      'so you can focus on your family',
    ],
  },
];

const STEP = SCENE_FRAMES - FADE;
const SCENES_START = INTRO_FRAMES - FADE;
const OUTRO_START = SCENES_START + SCENES.length * STEP;
export const TOTAL_FRAMES = OUTRO_START + OUTRO_FRAMES;

const EASE = Easing.inOut(Easing.cubic);

/**
 * A HANDOFF, not a true cross-fade.
 *
 * Consecutive scenes occupy opposite halves of the frame (the phone alternates),
 * so overlapping them at 50/50 shows two phones and two headlines ghosting
 * through each other. Instead the outgoing scene clears over the first half of
 * the overlap and the incoming one arrives over the second half. The brief pass
 * through the background is invisible at speed; the drift (see `driftX`) is what
 * carries the eye across it.
 */
const HANDOFF = FADE / 2;

function fadeOpacity(local: number, length: number): number {
  return Math.min(
    interpolate(local, [HANDOFF, FADE], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE,
    }),
    interpolate(local, [length - FADE, length - HANDOFF], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE,
    })
  );
}

/**
 * A scene drifts in from `dir` and continues out the same way, so consecutive
 * scenes move as one continuous pan instead of each arriving and leaving.
 */
function driftX(local: number, length: number, dir: 1 | -1): number {
  const enter = interpolate(local, [0, FADE], [46 * dir, 0], {
    extrapolateRight: 'clamp',
    easing: EASE,
  });
  const exit = interpolate(local, [length - FADE, length], [0, -46 * dir], {
    extrapolateLeft: 'clamp',
    easing: EASE,
  });
  return enter + exit;
}

/**
 * Staggered reveal: each element fades up a beat after the one above it, so the
 * eye is led down the caption rather than hit with the whole block at once.
 */
function reveal(local: number, delaySeconds: number): { opacity: number; translateY: number } {
  const start = SECONDS(delaySeconds);
  const t = interpolate(local, [start, start + SECONDS(0.5)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: EASE,
  });
  return { opacity: t, translateY: (1 - t) * 18 };
}

function revealStyle(local: number, delaySeconds: number): React.CSSProperties {
  const { opacity, translateY } = reveal(local, delaySeconds);
  return { opacity, transform: `translateY(${translateY}px)` };
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
    style={{ fontFamily: inter, fontStyle: 'italic', fontSize: size, color: COLORS.heritageOrange }}
  >
    every bean counts
  </div>
);

/**
 * Persistent brand mark. Rendered ONCE for the whole scene run, not per scene:
 * per-scene it would fade out and back in on every cross-fade, which is exactly
 * the blink a watermark exists to avoid. It sits below the phone's bottom edge
 * (see PHONE.height) so it clears the bezel on either side.
 */
const Watermark: React.FC<{ opacity: number }> = ({ opacity }) => (
  <div
    style={{
      position: 'absolute',
      right: 56,
      bottom: 38,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      opacity: opacity * 0.5,
    }}
  >
    <Img src={ART.logo} style={{ width: 36, height: 36 }} />
    <div style={{ fontFamily: outfit, fontWeight: 600, fontSize: 24 }}>
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
      ...revealStyle(local, 2.2),
      position: 'absolute',
      top: '52%',
      [side]: 18,
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
        fontSize: 22,
        color: COLORS.cloudWhite,
        background: COLORS.heritageOrange,
        padding: '9px 20px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        boxShadow: '0 8px 20px rgba(241, 93, 34, 0.28)',
      }}
    >
      {text}
    </div>
    <div style={{ width: 44, height: 3, borderRadius: 999, background: COLORS.heritageOrange }} />
  </div>
);

const Bullet: React.FC<{ text: string; local: number; delay: number; centered: boolean }> = ({
  text,
  local,
  delay,
  centered,
}) => {
  const { opacity, translateY } = reveal(local, delay);
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: centered ? 'center' : 'flex-start',
        gap: 16,
      }}
    >
      <div
        style={{
          width: 11,
          height: 11,
          borderRadius: 999,
          background: COLORS.heritageOrange,
          flexShrink: 0,
        }}
      />
      <div
        style={{
          fontFamily: inter,
          fontSize: centered ? 34 : 31,
          lineHeight: 1.35,
          color: COLORS.deepSlate,
          opacity: 0.9,
        }}
      >
        <RichText>{text}</RichText>
      </div>
    </div>
  );
};

const Caption: React.FC<{ scene: Scene; local: number; centered?: boolean }> = ({
  scene,
  local,
  centered = false,
}) => (
  <div style={{ maxWidth: centered ? 900 : 640 }}>
    <h1
      style={{
        ...revealStyle(local, 0.2),
        fontFamily: outfit,
        fontWeight: 700,
        fontSize: centered ? 72 : 58,
        lineHeight: 1.12,
        color: COLORS.deepSlate,
        margin: 0,
        textAlign: centered ? 'center' : 'left',
        // Headlines carry explicit \n so the highlighted run never dangles.
        whiteSpace: 'pre-line',
      }}
    >
      <RichText>{scene.headline}</RichText>
    </h1>
    <div
      style={{
        marginTop: 34,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        alignItems: centered ? 'center' : 'flex-start',
      }}
    >
      {scene.points.map((point, i) => (
        // 0.45s apart: slow enough to follow one line at a time, quick enough
        // that the last still has ~2.5s on screen before the scene fades.
        <Bullet key={point} text={point} local={local} delay={0.7 + i * 0.45} centered={centered} />
      ))}
    </div>
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
        <div style={revealStyle(local, 0.5)}>
          <Wordmark size={104} />
        </div>
        <div style={revealStyle(local, 0.95)}>
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
      <div style={revealStyle(local, 0.5)}>
        <Wordmark size={88} />
      </div>
      <div style={revealStyle(local, 0.95)}>
        <Tagline size={38} />
      </div>
      <div
        style={{
          ...revealStyle(local, 1.5),
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
      <Img src={ART.celebrating} style={{ ...revealStyle(local, 2.0), width: 460, marginTop: 8 }} />
    </AbsoluteFill>
  );
};

/** The privacy beat: brand art carrying the promise, no phone. */
const Statement: React.FC<{ scene: Scene; local: number }> = ({ scene, local }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: local, fps, config: { damping: 16, mass: 0.8 } });

  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34 }}
    >
      <div style={{ position: 'relative', transform: `scale(${0.9 + pop * 0.1})` }}>
        <Img src={ART.hugging} style={{ width: 250, height: 250 }} />
        <div
          style={{
            position: 'absolute',
            // Clear of the art: the beanies are never obscured (CIG golden rule).
            right: -54,
            bottom: 18,
            width: 88,
            height: 88,
            borderRadius: 999,
            background: COLORS.heritageOrange,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 44,
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

  // The watermark rides the whole scene run, fading in with the first scene and
  // out with the last, so it never blinks at a cross-fade.
  const watermark = Math.min(
    interpolate(frame, [SCENES_START, SCENES_START + FADE], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE,
    }),
    interpolate(frame, [OUTRO_START - FADE, OUTRO_START], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: EASE,
    })
  );

  // Warm wash drifts slowly across the whole video. Small, but it is most of
  // what makes six scenes feel like one piece rather than six.
  const washX = interpolate(frame, [0, TOTAL_FRAMES], [64, 36]);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.cloudWhite }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${washX}% 30%, ${COLORS.skySilk}55, transparent 60%)`,
        }}
      />

      {frame < INTRO_FRAMES ? <Intro local={frame} length={INTRO_FRAMES} /> : null}

      {SCENES.map((scene, i) => {
        const local = frame - (SCENES_START + i * STEP);
        if (local < 0 || local > SCENE_FRAMES) return null;

        // Alternate sides so the eye moves. Even scenes: phone left.
        const phoneLeft = i % 2 === 0;
        const x = driftX(local, SCENE_FRAMES, phoneLeft ? 1 : -1);

        if (!scene.src) {
          return (
            <AbsoluteFill
              key={scene.headline}
              style={{
                opacity: fadeOpacity(local, SCENE_FRAMES),
                transform: `translateX(${x}px)`,
              }}
            >
              <Statement scene={scene} local={local} />
            </AbsoluteFill>
          );
        }

        return (
          <AbsoluteFill
            key={scene.src}
            style={{
              opacity: fadeOpacity(local, SCENE_FRAMES),
              transform: `translateX(${x}px)`,
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
          </AbsoluteFill>
        );
      })}

      {watermark > 0 ? <Watermark opacity={watermark} /> : null}

      {frame >= OUTRO_START ? <Outro local={frame - OUTRO_START} length={OUTRO_FRAMES} /> : null}
    </AbsoluteFill>
  );
};
