import React from 'react';
import {
  AbsoluteFill,
  Audio,
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
import { loadFont as loadCaveat } from '@remotion/google-fonts/Caveat';
import { COLORS, VIDEO } from './brand';
import { ART } from './assets';
import { Phone } from './Phone';
import { RichText } from './RichText';
import { musicVolume } from './audio';
import track from './audio/track.mp3';

const outfit = loadOutfit().fontFamily;
const inter = loadInter().fontFamily;
const caveat = loadCaveat().fontFamily;

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
  /** Two facts. They hang off the growing stem. */
  points: [string, string];
  /** The payoff. Handwritten, and the only Caveat on the screen. */
  summary: string;
  /** Optional pill that points back at the phone. Keep to at most one per video. */
  callout?: string;
};

const SCENES: Scene[] = [
  {
    src: '01-nook.png',
    headline: 'all your little beans,\n**in one place**',
    points: ["what's on today", "who's doing it"],
    summary: 'no more mental load',
  },
  {
    src: '02-planner.png',
    headline: 'one calendar,\n**shared with everyone**',
    points: ['lessons, dinners, appointments', 'travel plans, and everything else'],
    summary: 'no more whose turn is it?',
  },
  {
    src: '03-todos.png',
    headline: 'share the load,\n**get stuff done**',
    points: ['assign it to a bean', 'tick it off'],
    summary: 'and the beanies celebrate with you',
    callout: 'tick it off',
  },
  {
    src: '04-money.png',
    headline: 'know **where you stand**',
    points: ['accounts, spending, budgets', 'goals and your real net worth'],
    summary: 'together, and fully private',
  },
  {
    src: '05-meet-the-beans.png',
    headline: 'everything about\n**your beanies**',
    points: ['favorite foods, medications', 'a scrapbook for precious moments'],
    summary: 'every bean gets a place',
  },
  {
    headline: 'fully private, **guaranteed**',
    points: ['encrypted, and stays with you', 'beanies *never* stores your data'],
    summary: 'so you can focus on your family',
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
  const t = interpolate(local, [start, start + SECONDS(0.42)], [0, 1], {
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
      ...revealStyle(local, 2.15),
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
        boxShadow: '0 8px 24px rgba(241, 93, 34, 0.18)',
      }}
    >
      {text}
    </div>
    <div style={{ width: 44, height: 3, borderRadius: 999, background: COLORS.heritageOrange }} />
  </div>
);

/**
 * "The sprout" — how a scene's three supporting points are laid out.
 *
 * They are not three peers, so three identical bullets misrepresent them: the
 * first two are facts, the third is the payoff. A Heritage Orange -> Terracotta
 * stem grows down beside the facts (each marked with the brand's own impact-bullet
 * asset, the CIG's designated bullet), then detaches at the summary, which blooms
 * as a handwritten Caveat line on an orange tint.
 *
 * That summary is the ONE Caveat element per scene. The CIG is explicit: reach
 * for it more than once on a screen and you are using it wrong.
 */
const Fact: React.FC<{ text: string; local: number; delay: number; centered: boolean }> = ({
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
        gap: 18,
      }}
    >
      <Img src={ART.impactBullet} style={{ width: 30, height: 30, flexShrink: 0 }} />
      <div
        style={{
          fontFamily: inter,
          fontSize: centered ? 33 : 30,
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

/**
 * One continuous growth, not three timed events.
 *
 * The stem grows for GROW_SECONDS, and each element reveals as the stem reaches
 * it. The reveals overlap the stem's travel deliberately: an element that waits
 * for the stem to arrive before starting to fade reads as a hesitation, because
 * the eye sees the stem stop, then a pause, then a pop. Starting each reveal
 * slightly early means something is always in motion.
 */
const GROW_START = 0.55;
const GROW_SECONDS = 1.5;
/** Where along the stem's travel each element sits, 0..1. */
const AT_FACT_1 = 0.0;
const AT_FACT_2 = 0.3;
const AT_SUMMARY = 0.56;

const at = (t: number) => GROW_START + t * GROW_SECONDS;

/** The payoff. Handwritten, Heritage Orange, on an orange-8 tint pill. */
const Summary: React.FC<{ text: string; local: number; centered: boolean }> = ({
  text,
  local,
  centered,
}) => {
  const { opacity, translateY } = reveal(local, at(AT_SUMMARY));
  // Blooms rather than slides: it is the one element the stem does not carry.
  const scale = interpolate(opacity, [0, 1], [0.94, 1]);
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        transformOrigin: centered ? 'center' : 'left center',
        display: 'flex',
        justifyContent: centered ? 'center' : 'flex-start',
      }}
    >
      <div
        style={{
          fontFamily: caveat,
          fontWeight: 700,
          fontSize: centered ? 50 : 46,
          lineHeight: 1.2,
          color: COLORS.heritageOrange,
          background: 'rgba(241, 93, 34, 0.08)',
          padding: '12px 30px 8px',
          borderRadius: 24,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Points: React.FC<{ scene: Scene; local: number; centered: boolean }> = ({
  scene,
  local,
  centered,
}) => {
  // Grows past the last fact and on toward the summary, so the eye is already
  // travelling when the summary begins to bloom.
  const grow = interpolate(
    local,
    [SECONDS(GROW_START), SECONDS(GROW_START + GROW_SECONDS * AT_SUMMARY)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) }
  );

  return (
    <div style={{ position: 'relative', marginTop: 34 }}>
      {!centered ? (
        <div
          style={{
            position: 'absolute',
            left: 14,
            top: 6,
            width: 3,
            height: 150,
            borderRadius: 999,
            background: `linear-gradient(${COLORS.heritageOrange}, ${COLORS.terracotta})`,
            transform: `scaleY(${grow})`,
            transformOrigin: 'top',
          }}
        />
      ) : null}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          alignItems: centered ? 'center' : 'flex-start',
        }}
      >
        {scene.points.map((point, i) => (
          <Fact
            key={point}
            text={point}
            local={local}
            delay={at(i === 0 ? AT_FACT_1 : AT_FACT_2)}
            centered={centered}
          />
        ))}
        <div style={{ marginTop: 14 }}>
          <Summary text={scene.summary} local={local} centered={centered} />
        </div>
      </div>
    </div>
  );
};

const Caption: React.FC<{ scene: Scene; local: number; centered?: boolean }> = ({
  scene,
  local,
  centered = false,
}) => (
  <div style={{ maxWidth: centered ? 900 : 660 }}>
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
    <Points scene={scene} local={local} centered={centered} />
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
          boxShadow: '0 10px 34px rgba(241, 93, 34, 0.20)',
        }}
      >
        fully private and secure
      </div>
      <Img src={ART.celebrating} style={{ ...revealStyle(local, 2.0), width: 460, marginTop: 8 }} />
    </AbsoluteFill>
  );
};

/**
 * The privacy beat: brand art carrying the promise, no phone.
 *
 * Uses `beanies_covering_eyes`, which the CIG designates for "data encrypted",
 * rather than a padlock. Security should read as quiet confidence, not alarm.
 */
const Statement: React.FC<{ scene: Scene; local: number }> = ({ scene, local }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: local, fps, config: { damping: 16, mass: 0.8 } });

  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26 }}
    >
      <Img
        src={ART.coveringEyes}
        style={{ width: 250, height: 250, transform: `scale(${0.9 + pop * 0.1})` }}
      />
      <Caption scene={scene} local={local} centered />
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
      {/* The track is 37s against a 35.95s cut, so it never loops or runs dry.
          Full level from frame 0, gentle fall at the end — see audio.ts. */}
      <Audio src={track} volume={(f) => musicVolume(f, { totalFrames: TOTAL_FRAMES, fps })} />

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
