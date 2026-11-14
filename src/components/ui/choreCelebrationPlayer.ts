/**
 * The chore celebration's choreography (#146), ported from the owner-approved v4 mockup
 * (`~/projects/beanies-ops/docs/mockups/chore-celebration-v4-2026-11-14.html`). Moves, beats,
 * curves and sizes are the mockup's; only the plumbing changed: it draws into a stage the
 * overlay gives it, finds the banner by its `data-celebration-*` hooks, and owns every timer and
 * animation it starts so `cancel()` leaves nothing behind.
 *
 * Transform and opacity only, measured once per phase (the tick at the tap, the banner when it
 * arrives), never interleaved with writes. Loaded only with `ChoreCelebration.vue` (lazy).
 */
import {
  CHORE_CELEBRATION_ART as ART,
  CHORE_CELEBRATION_BEATS as BEATS,
  type ChoreMoveId,
  type RectLike,
} from '@/utils/choreCelebration';

/** The Pod's four colours, in their mandated order (confetti, sparks and canopies). */
const POD = ['#2C3E50', '#E67E22', '#F15D22', '#AED6F1'] as const;
const STAR = '⭐';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** An inline SVG built node by node (no markup strings): `paths` are attribute maps. */
function svg(viewBox: string, paths: Record<string, string>[]): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('width', '100%');
  root.setAttribute('height', '100%');
  root.setAttribute('aria-hidden', 'true');
  for (const attrs of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    for (const [k, v] of Object.entries(attrs)) path.setAttribute(k, v);
    root.append(path);
  }
  return root;
}

/** The white four-point twinkle. */
const twinkleSvg = () =>
  svg('0 0 24 24', [
    {
      fill: 'currentColor',
      d: 'M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0Z',
    },
  ]);

/** A little pod-colour parachute canopy with its three strings. */
const canopySvg = (fill: string) =>
  svg('0 0 100 62', [
    {
      d: 'M8 26 Q50 -14 92 26 Q81 20 71 26 Q61 20 50 26 Q39 20 29 26 Q19 20 8 26 Z',
      fill,
      stroke: 'rgb(255 255 255 / 75%)',
      'stroke-width': '1.5',
    },
    {
      class: 'cc-strings',
      d: 'M12 26 L40 60 M88 26 L60 60 M50 26 L50 60',
      'stroke-width': '1.6',
      fill: 'none',
    },
  ]);

const { swap: SWAP, enter: ENTER, praiseAt: PRAISE_AT, fly: FLY, flyGap: FLY_GAP } = BEATS;
const { settle: SETTLE } = BEATS;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const center = (r: RectLike) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The banner's geometry once it has arrived, in stage coordinates. */
interface Geometry {
  /** The stage's width. */
  W: number;
  /** The banner. */
  B: RectLike;
  /** The banner's picture (where the beanies stand, and settle). */
  S: RectLike;
  /** The wall's sizing. */
  compact: boolean;
  cx: number;
  foot: number;
}

interface Actor {
  a: HTMLDivElement;
  inner: HTMLDivElement;
}

interface FlyingStar {
  el: HTMLDivElement;
  bx: number;
  by: number;
  r: number;
}

export interface BurstInput {
  /** Where the stars burst from: the last tick, in stage coordinates. */
  tick: RectLike;
  /** The finished block (stars stay over it), in stage coordinates. */
  area: RectLike;
  /** The tick element, for its pop, when it is still on screen. */
  tickEl: HTMLElement | null;
  /** The block element, which steps aside for the banner. */
  blockEl: HTMLElement | null;
  /**
   * Drawing started after the banner already arrived (a slow first load of this code): skip the
   * block's step-aside, which would otherwise fade the block AND its new banner out.
   */
  late?: boolean;
}

export interface ChoreCelebrationPlayer {
  /** The tick pops, sparks spring from it and the stars burst out. */
  burst(input: BurstInput): void;
  /** The banner has arrived: the beanies' move, the praise line, the stars fly home, settle. */
  arrive(banner: HTMLElement): void;
  /** Reduced motion: no movement; the praise gives way to the banner's words by fading. */
  calm(banner: HTMLElement): void;
  /** Fade an element out so it is gone by `endMs` (the centered banner). */
  fadeOutBy(el: HTMLElement, endMs: number): void;
  /** Shift everything drawn so far by (dx, dy): the board scrolled under the celebration. */
  follow(dx: number, dy: number): void;
  /** Stop every timer and animation and remove everything this player drew. */
  cancel(): void;
}

export interface PlayerOptions {
  /**
   * What the celebration draws in: a box filling the fixed, clipping stage. It follows a scroll
   * as a whole (one transform), carrying the overlay's own banner with it when there is one.
   */
  stage: HTMLElement;
  /** The stage's top-left in viewport px. */
  origin: { x: number; y: number };
  move: ChoreMoveId;
  /** Chores in the block: one star each. */
  count: number;
  /** `performance.now()` at the tick: every beat is timed from here. */
  startedAt: number;
  compact: boolean;
}

export function createChoreCelebrationPlayer(opts: PlayerOptions): ChoreCelebrationPlayer {
  const { stage, origin, count, compact } = opts;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let anims: Animation[] = [];
  let followed = { dx: 0, dy: 0 };
  let stars: FlyingStar[] = [];
  let aside: Animation | null = null;
  let arrived = false;
  let cancelled = false;

  // Everything drawn lives in one layer above anything the overlay put in the stage.
  const layer = document.createElement('div');
  layer.className = 'cc-layer';
  stage.append(layer);

  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize || '16') || 16;
  /** The star glyph's size: the banner's star row (1.5rem, or 1.125rem on the wall). */
  const fs = (compact ? 1.125 : 1.5) * rootPx;

  // ── timeline helpers (the mockup's `at` / `later` / `anim`) ──
  const nowRel = () => performance.now() - opts.startedAt;
  const at = (ms: number) => Math.max(0, ms - nowRel());
  function later(ms: number, fn: () => void): void {
    timers.push(setTimeout(fn, at(ms)));
  }
  function anim(
    el: Element | null | undefined,
    kf: Keyframe[],
    o: KeyframeAnimationOptions
  ): Animation | null {
    if (!el || cancelled || typeof (el as HTMLElement).animate !== 'function') return null;
    const a = (el as HTMLElement).animate(kf, o);
    anims.push(a);
    return a;
  }

  /** An element's rect in stage coordinates (the layer may have followed a scroll). */
  function local(el: Element): RectLike {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - origin.x - followed.dx,
      y: r.top - origin.y - followed.dy,
      w: r.width,
      h: r.height,
    };
  }

  function div(cls: string, css: string, parent: HTMLElement = layer): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    if (css) d.style.cssText = css;
    parent.append(d);
    return d;
  }

  function makeActor(
    x: number,
    y: number,
    w: number,
    h: number,
    src: string,
    parent: HTMLElement = layer
  ): Actor {
    const a = div('cc-actor', `left:${x}px;top:${y}px;width:${w}px;height:${h}px`, parent);
    const inner = div('cc-actor-inner', '', a);
    const img = new Image();
    img.src = src;
    img.alt = '';
    img.decoding = 'sync';
    img.draggable = false;
    inner.append(img);
    return { a, inner };
  }

  const q = (root: Element, sel: string) => root.querySelector<HTMLElement>(sel);
  const qa = (root: Element, sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

  // ── extra sparkle (every move) ──

  /** A small burst at a bean's feet: pod-colour bits and tiny stars, spraying UP. */
  function miniBurst(x: number, y: number, ms: number, big = false): void {
    const n = big ? 11 : 7;
    for (let k = 0; k < n; k++) {
      const sp = div('cc-spark', `background:${POD[k % 4]}`);
      const ang = rad(-165 + (150 / (n - 1)) * k + rand(-6, 6));
      const d = rand(big ? 26 : 16, big ? 56 : 38);
      anim(
        sp,
        [
          { transform: `translate(${x}px,${y}px) scale(.6)`, opacity: 0 },
          {
            transform: `translate(${x + Math.cos(ang) * d * 0.6}px,${y + Math.sin(ang) * d * 0.6}px) scale(1)`,
            opacity: 1,
            offset: 0.35,
          },
          {
            transform: `translate(${x + Math.cos(ang) * d}px,${y + Math.sin(ang) * d}px) scale(.4)`,
            opacity: 0,
          },
        ],
        { duration: 480, delay: at(ms), easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' }
      );
    }
    for (let k = 0; k < (big ? 3 : 2); k++) {
      const st = div('cc-fstar', 'font-size:12px');
      st.textContent = STAR;
      const ang = rad(-130 + k * (big ? 40 : 80) + rand(-10, 10));
      const d = rand(22, big ? 52 : 40);
      const ex = x + Math.cos(ang) * d;
      const ey = y + Math.sin(ang) * d;
      anim(
        st,
        [
          { transform: `translate(${x}px,${y}px) scale(.3) rotate(0deg)`, opacity: 0 },
          {
            transform: `translate(${ex}px,${ey}px) scale(1.1) rotate(90deg)`,
            opacity: 1,
            offset: 0.6,
          },
          { transform: `translate(${ex}px,${ey - 6}px) scale(.6) rotate(140deg)`, opacity: 0 },
        ],
        { duration: 560, delay: at(ms), easing: 'ease-out', fill: 'both' }
      );
    }
  }

  /** Pod-colour confetti popping out from behind the beanies, all ABOVE their feet. */
  function confettiAround(cx: number, top: number, foot: number, spanW: number, ms: number): void {
    const forms = [
      ['11px', '7px', '2px'],
      ['5px', '13px', '2px'],
      ['9px', '9px', '50%'],
      ['10px', '10px', '60% 0'],
    ] as const;
    for (let k = 0; k < 18; k++) {
      const [w, h, r] = forms[k % 4]!;
      const bit = div(
        'cc-spark',
        `width:${w};height:${h};border-radius:${r};left:-3px;top:-3px;background:${POD[k % 4]}`
      );
      const side = k % 2 ? 1 : -1;
      const ex = cx + side * rand(spanW * 0.25, spanW * 0.62);
      const ey = rand(top - 26, foot - 18);
      const sx = cx + side * rand(0, spanW * 0.15);
      const sy = (top + foot) / 2;
      const rot = rand(-260, 260);
      anim(
        bit,
        [
          { transform: `translate(${sx}px,${sy}px) rotate(0deg) scale(.4)`, opacity: 0 },
          {
            transform: `translate(${ex}px,${ey}px) rotate(${rot * 0.5}deg) scale(1)`,
            opacity: 1,
            offset: 0.3,
          },
          {
            transform: `translate(${ex + side * 5}px,${ey + 12}px) rotate(${rot * 0.8}deg) scale(1)`,
            opacity: 1,
            offset: 0.75,
          },
          {
            transform: `translate(${ex + side * 8}px,${ey + 20}px) rotate(${rot}deg) scale(.9)`,
            opacity: 0,
          },
        ],
        { duration: 950, delay: at(ms + k * 18), easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'both' }
      );
    }
  }

  /** A white four-point twinkle on a star the moment it lands in the row. */
  function twinkle(x: number, y: number, size: number): void {
    const t = div('cc-fstar', `font-size:${size}px;color:#fff`);
    t.append(twinkleSvg());
    const a = anim(
      t,
      [
        { transform: `translate(${x}px,${y}px) scale(0) rotate(0deg)`, opacity: 1 },
        {
          transform: `translate(${x}px,${y}px) scale(1.5) rotate(45deg)`,
          opacity: 1,
          offset: 0.45,
        },
        { transform: `translate(${x}px,${y}px) scale(.2) rotate(90deg)`, opacity: 0 },
      ],
      { duration: 420, easing: 'ease-out', fill: 'forwards' }
    );
    if (a) a.onfinish = () => t.remove();
  }

  /** The banner's own picture fades in where the beanies leave it. */
  function fadeInBannerImage(banner: HTMLElement, ms: number): void {
    anim(
      q(banner, '[data-celebration-picture]'),
      [
        { opacity: 0, transform: 'scale(.85)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 300, delay: at(ms), easing: 'ease-out', fill: 'forwards' }
    );
  }

  /** The big group shrinks, feet first, into the exact spot of the banner's picture. */
  function shrinkIntoBanner(G: Geometry, act: Actor, banner: HTMLElement, bigW: number): void {
    anim(act.a, [{ transform: 'scale(1)' }, { transform: `scale(${G.S.w / bigW})` }], {
      duration: 440,
      delay: at(SETTLE),
      easing: 'cubic-bezier(.4,0,.2,1)',
      fill: 'forwards',
    });
    anim(q(banner, '[data-celebration-picture]'), [{ opacity: 0 }, { opacity: 1 }], {
      duration: 1,
      delay: at(SETTLE + 440),
      fill: 'forwards',
    });
    later(SETTLE + 450, () => act.a.remove());
  }

  function bigGroupWidth(G: Geometry): number {
    return G.compact ? Math.min(G.B.w * 1.05, 440) : Math.min(G.W - 24, 340);
  }

  // ── the line of five ──

  interface Slot {
    k: number;
    w: number;
    h: number;
    x: number;
    y: number;
    rowW: number;
  }

  /** Where the five dancers stand once in their line: shoulder to shoulder on the picture. */
  function lineSlots(G: Geometry): Slot[] {
    const rowW = G.compact ? Math.min(G.B.w * 1.1, 470) : Math.min(G.W - 16, 360);
    const w = rowW / 4.4;
    const gap = (rowW - w) / 4;
    const lift = [4, -10, -18, -10, 4];
    return ART.dancers.map((d, k) => {
      const h = w * (d.h / d.w);
      return { k, w, h, x: G.cx - rowW / 2 + k * gap, y: G.foot + 6 + lift[k]! - h, rowW };
    });
  }

  function makeLine(G: Geometry): { s: Slot; act: Actor }[] {
    return lineSlots(G).map((s) => ({
      s,
      act: makeActor(s.x, s.y, s.w, s.h, ART.dancers[s.k]!.src),
    }));
  }

  const feetOf = (s: Slot) => ({ x: s.x + s.w / 2, y: s.y + s.h - 4 });

  function hop(el: HTMLElement, ms: number, k: number, height = 38, dur = 520, iterations = 1) {
    const sign = k % 2 ? 1 : -1;
    anim(
      el,
      [
        { transform: 'translateY(0) scale(1) rotate(0deg)' },
        { transform: 'translateY(0) scale(1.08,.9) rotate(0deg)', offset: 0.12 },
        {
          transform: `translateY(${-height}px) scale(.96,1.05) rotate(${sign * 9}deg)`,
          offset: 0.45,
        },
        { transform: 'translateY(0) scale(1.08,.9) rotate(0deg)', offset: 0.85 },
        { transform: 'translateY(0) scale(1) rotate(0deg)' },
      ],
      { duration: dur, delay: at(ms), iterations, easing: 'ease-in-out' }
    );
  }

  /** The line closes up toward the middle and melts into the banner's holding-hands picture. */
  function settleLine(G: Geometry, line: { s: Slot; act: Actor }[], banner: HTMLElement) {
    line.forEach(({ s, act }, k) => {
      const dx = G.cx - (s.x + s.w / 2);
      anim(
        act.a,
        [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx * 0.45}px, 0) scale(.92)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, 16px) scale(.35)`, opacity: 0 },
        ],
        { duration: 420, delay: at(SETTLE + k * 30), easing: 'ease-in', fill: 'forwards' }
      );
    });
    fadeInBannerImage(banner, SETTLE + 200);
  }

  function lineConfetti(G: Geometry, line: { s: Slot; act: Actor }[], ms: number) {
    confettiAround(G.cx, Math.min(...line.map((l) => l.s.y)), G.foot, line[0]!.s.rowW, ms);
  }

  const img = (act: Actor) => act.inner.querySelector('img');

  // ── the seven moves ──

  const MOVES: Record<ChoreMoveId, (G: Geometry, clip: HTMLElement, banner: HTMLElement) => void> =
    {
      // Mon. Bounce party: the five bounce up one after another into their line and jump.
      'bounce-party'(G, _clip, banner) {
        const line = makeLine(G);
        line.forEach(({ s, act }, k) => {
          anim(
            act.inner,
            [
              { transform: 'translateY(90px) scale(.3)', opacity: 0 },
              { transform: 'translateY(-34px) scale(.95,1.08)', opacity: 1, offset: 0.55 },
              { transform: 'translateY(0) scale(1.12,.86)', opacity: 1, offset: 0.8 },
              { transform: 'translateY(0) scale(1)', opacity: 1 },
            ],
            { duration: 560, delay: at(ENTER + k * 120), easing: 'ease-out', fill: 'both' }
          );
          const f = feetOf(s);
          miniBurst(f.x, f.y, ENTER + k * 120 + 448);
          hop(act.inner, FLY + k * 80, k, 38, 520, 2);
        });
        lineConfetti(G, line, 1880);
        settleLine(G, line, banner);
      },

      // Tue. Peek-a-boo: the family pops up from behind the banner, wiggles, ducks back down.
      'peek-a-boo'(G, clip, banner) {
        // Never taller than the room above the banner, so no hat is cut off at the top.
        const room = Math.max(0, (G.B.y - 2) * (ART.peek.w / ART.peek.h));
        const pw = Math.min(
          G.compact ? Math.min(G.B.w * 0.92, 390) : Math.min(G.W * 0.84, 330),
          room
        );
        const ph = pw * (ART.peek.h / ART.peek.w);
        const act = makeActor(
          G.B.x + G.B.w / 2 - pw / 2,
          G.B.y + 6 - ph,
          pw,
          ph,
          ART.peek.src,
          clip
        );
        anim(
          act.inner,
          [
            { transform: 'translateY(105%)' },
            { transform: 'translateY(-12%)', offset: 0.6 },
            { transform: 'translateY(4%)', offset: 0.82 },
            { transform: 'translateY(0)' },
          ],
          { duration: 640, delay: at(ENTER), easing: 'ease-out', fill: 'both' }
        );
        [0.18, 0.5, 0.82].forEach((p, k) =>
          miniBurst(G.B.x + G.B.w * p, G.B.y - 2, ENTER + 330 + k * 60, k === 1)
        );
        anim(
          act.inner,
          [
            { transform: 'translateY(0) rotate(0deg)' },
            { transform: 'translateY(-9%) rotate(-4deg)', offset: 0.25 },
            { transform: 'translateY(0) rotate(0deg)', offset: 0.5 },
            { transform: 'translateY(-9%) rotate(4deg)', offset: 0.75 },
            { transform: 'translateY(0) rotate(0deg)' },
          ],
          { duration: 640, delay: at(FLY + 20), iterations: 2, easing: 'ease-in-out' }
        );
        confettiAround(G.B.x + G.B.w / 2, G.B.y - ph * 0.9, G.B.y - 4, pw, 1900);
        anim(
          act.inner,
          [
            { transform: 'translateY(0)' },
            { transform: 'translateY(-8%)', offset: 0.3 },
            { transform: 'translateY(110%)' },
          ],
          { duration: 440, delay: at(SETTLE), easing: 'ease-in', fill: 'forwards' }
        );
        fadeInBannerImage(banner, SETTLE + 300);
      },

      // Wed. Parade: the four, holding hands, hop in from the side, do a FLAT spin in the air
      // (never mirrored), and shrink into the banner.
      parade(G, _clip, banner) {
        const bw = bigGroupWidth(G);
        const bh = bw * (ART.line.h / ART.line.w);
        const act = makeActor(G.cx - bw / 2, G.foot - bh, bw, bh, ART.line.src);
        anim(
          act.a,
          [{ transform: `translateX(${-(G.cx + bw / 2 + 24)}px)` }, { transform: 'translateX(0)' }],
          { duration: 980, delay: at(ENTER), easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'both' }
        );
        anim(
          act.inner,
          [
            { transform: 'translateY(0) rotate(-3deg)' },
            { transform: 'translateY(-16px) rotate(0deg)', offset: 0.5 },
            { transform: 'translateY(0) rotate(3deg)' },
          ],
          {
            duration: 245,
            delay: at(ENTER),
            iterations: 4,
            direction: 'alternate',
            easing: 'ease-in-out',
          }
        );
        [-0.3, 0, 0.3].forEach((p) => miniBurst(G.cx + bw * p, G.foot - 4, ENTER + 980, p === 0));
        const o = { transformOrigin: '50% 55%' };
        anim(
          act.inner,
          [
            { transform: 'translateY(0) rotate(0deg) scale(1)', ...o },
            { transform: 'translateY(0) rotate(0deg) scale(1.06,.9)', offset: 0.18, ...o },
            {
              transform: `translateY(${-bh * 0.42}px) rotate(300deg) scale(.9)`,
              offset: 0.6,
              ...o,
            },
            { transform: 'translateY(0) rotate(360deg) scale(1.06,.92)', offset: 0.85, ...o },
            { transform: 'translateY(0) rotate(360deg) scale(1)', ...o },
          ],
          { duration: 640, delay: at(1660), easing: 'ease-in-out' }
        );
        confettiAround(G.cx, G.foot - bh, G.foot, bw, 2180);
        [-0.25, 0.25].forEach((p) => miniBurst(G.cx + bw * p, G.foot - 4, 2210));
        shrinkIntoBanner(G, act, banner, bw);
      },

      // Thu. Drop in: the four fall from the top, land with a squash and stretch, jump twice.
      'drop-in'(G, _clip, banner) {
        const bw = bigGroupWidth(G);
        const bh = bw * (ART.line.h / ART.line.w);
        const act = makeActor(G.cx - bw / 2, G.foot - bh, bw, bh, ART.line.src);
        anim(
          act.a,
          [{ transform: `translateY(${-(G.foot + 30)}px)` }, { transform: 'translateY(0)' }],
          { duration: 460, delay: at(ENTER), easing: 'cubic-bezier(.55,0,1,.45)', fill: 'both' }
        );
        anim(
          act.inner,
          [
            { transform: 'translateY(0) scale(1,1)' },
            { transform: 'translateY(0) scale(1.18,.74)', offset: 0.18 },
            { transform: 'translateY(-28px) scale(.92,1.1)', offset: 0.45 },
            { transform: 'translateY(0) scale(1.08,.9)', offset: 0.7 },
            { transform: 'translateY(0) scale(.98,1.03)', offset: 0.85 },
            { transform: 'translateY(0) scale(1,1)' },
          ],
          { duration: 560, delay: at(ENTER + 460), easing: 'ease-out' }
        );
        [-0.36, -0.12, 0.12, 0.36].forEach((p, k) =>
          miniBurst(G.cx + bw * p, G.foot - 4, ENTER + 470, k === 1 || k === 2)
        );
        anim(
          act.inner,
          [
            { transform: 'translateY(0) scale(1)' },
            { transform: 'translateY(0) scale(1.1,.86)', offset: 0.15 },
            { transform: 'translateY(-42px) scale(.95,1.07)', offset: 0.5 },
            { transform: 'translateY(0) scale(1.1,.86)', offset: 0.85 },
            { transform: 'translateY(0) scale(1)' },
          ],
          { duration: 420, delay: at(1680), iterations: 2, easing: 'ease-in-out' }
        );
        miniBurst(G.cx, G.foot - 4, 1680 + 357);
        confettiAround(G.cx, G.foot - bh, G.foot, bw, 1760);
        shrinkIntoBanner(G, act, banner, bw);
      },

      // Fri. Tumble in: the five roll in from alternating sides, land in place, and hop.
      'tumble-in'(G, _clip, banner) {
        const line = makeLine(G);
        line.forEach(({ s, act }, k) => {
          const fromLeft = k % 2 === 0;
          // On a phone from the stage's edges; on the wall only from this bean's lane edges,
          // so nobody tumbles across a sibling's chores.
          const left = G.compact ? G.B.x - 30 : 0;
          const right = G.compact ? G.B.x + G.B.w + 30 : G.W;
          const dist = fromLeft ? -(s.x - left + s.w + 10) : right - s.x + 10;
          const turns = fromLeft ? -540 : 540;
          const o = { transformOrigin: '50% 55%' };
          anim(
            act.inner,
            [
              { transform: `translateX(${dist}px) rotate(${turns}deg)`, opacity: 0, ...o },
              { opacity: 1, offset: 0.2, ...o },
              {
                transform: `translateX(${dist * 0.06}px) rotate(${turns * 0.04}deg)`,
                opacity: 1,
                offset: 0.8,
                ...o,
              },
              { transform: 'translateX(0) rotate(0deg)', opacity: 1, ...o },
            ],
            {
              duration: 640,
              delay: at(ENTER + k * 110),
              easing: 'cubic-bezier(.25,.7,.4,1)',
              fill: 'both',
            }
          );
          const land = ENTER + k * 110 + 640;
          anim(
            img(act),
            [
              { transform: 'scale(1)' },
              { transform: 'scale(1.14,.84)', offset: 0.35 },
              { transform: 'scale(.96,1.05)', offset: 0.7 },
              { transform: 'scale(1)' },
            ],
            { duration: 300, delay: at(land - 40), easing: 'ease-out' }
          );
          const f = feetOf(s);
          miniBurst(f.x, f.y, land - 30);
          hop(act.inner, 1820 + k * 60, k, 34, 480);
        });
        lineConfetti(G, line, 1900);
        settleLine(G, line, banner);
      },

      // Sat. Stadium wave: the five pop up left to right, then do a stadium wave twice.
      'stadium-wave'(G, _clip, banner) {
        const line = makeLine(G);
        line.forEach(({ s, act }, k) => {
          anim(
            act.inner,
            [
              { transform: 'translateY(70px) scale(.4)', opacity: 0 },
              { transform: 'translateY(-22px) scale(1.05)', opacity: 1, offset: 0.6 },
              { transform: 'translateY(0) scale(1)', opacity: 1 },
            ],
            { duration: 420, delay: at(ENTER + k * 90), easing: 'ease-out', fill: 'both' }
          );
          const f = feetOf(s);
          miniBurst(f.x, f.y, ENTER + k * 90 + 250);
          [FLY, FLY + 520].forEach((start) =>
            anim(
              act.inner,
              [
                { transform: 'translateY(0) scale(1)' },
                { transform: 'translateY(0) scale(1.06,.9)', offset: 0.15 },
                { transform: 'translateY(-46px) scale(.94,1.1)', offset: 0.5 },
                { transform: 'translateY(0) scale(1.06,.9)', offset: 0.85 },
                { transform: 'translateY(0) scale(1)' },
              ],
              { duration: 380, delay: at(start + k * 80), easing: 'ease-in-out' }
            )
          );
        });
        lineConfetti(G, line, 1980);
        settleLine(G, line, banner);
      },

      // Sun. Parachutes: the five float down on pod-colour canopies, let go on landing, and
      // hop over into their line.
      parachutes(G, _clip, banner) {
        const line = makeLine(G);
        const order = [2, 0, 4, 1, 3];
        line.forEach(({ s, act }, k) => {
          const j = order.indexOf(k);
          const cw = s.w * 1.15;
          const chh = s.w * 0.62;
          const can = div(
            'cc-canopy',
            `left:${(s.w - cw) / 2}px;bottom:${s.h - 6}px;width:${cw}px;height:${chh}px`,
            act.inner
          );
          can.append(canopySvg(POD[k % 4]!));
          const off = (k - 2) * 10 + rand(-6, 6);
          const y0 = -(s.y + s.h + chh + 20);
          anim(
            act.inner,
            [
              { transform: `translate(${off + 12}px,${y0}px) rotate(8deg)` },
              { transform: `translate(${off - 12}px,${y0 * 0.62}px) rotate(-8deg)`, offset: 0.33 },
              { transform: `translate(${off + 9}px,${y0 * 0.26}px) rotate(6deg)`, offset: 0.66 },
              { transform: `translate(${off}px,0) rotate(0deg)` },
            ],
            {
              duration: 860,
              delay: at(ENTER + j * 120),
              easing: 'cubic-bezier(.3,.15,.5,1)',
              fill: 'both',
            }
          );
          const land = ENTER + j * 120 + 860;
          anim(
            can,
            [
              { transform: 'none', opacity: 1 },
              { transform: 'translateY(-46px) rotate(12deg) scale(.8)', opacity: 0 },
            ],
            { duration: 480, delay: at(land), easing: 'ease-in', fill: 'forwards' }
          );
          anim(
            img(act),
            [
              { transform: 'scale(1)' },
              { transform: 'scale(1.12,.86)', offset: 0.4 },
              { transform: 'scale(1)' },
            ],
            { duration: 260, delay: at(land - 20), easing: 'ease-out' }
          );
          const f = feetOf(s);
          miniBurst(f.x + off, f.y, land);
          anim(
            act.inner,
            [
              { transform: `translate(${off}px,0)` },
              { transform: `translate(${off / 2}px,-20px)`, offset: 0.5 },
              { transform: 'translate(0,0)' },
            ],
            { duration: 240, delay: at(land + 120), easing: 'ease-in-out', fill: 'forwards' }
          );
        });
        lineConfetti(G, line, 2120);
        settleLine(G, line, banner);
      },
    };

  // ── the phases ──

  /** The tick pops, and a ring and pod-colour sparks spring from it. */
  function tickPop(tc: { x: number; y: number }, tick: RectLike, tickEl: HTMLElement | null) {
    if (tickEl?.isConnected) {
      anim(
        tickEl,
        [
          { transform: 'scale(1)' },
          { transform: 'scale(.82)', offset: 0.3 },
          { transform: 'scale(1.18)', offset: 0.65 },
          { transform: 'scale(1)' },
        ],
        { duration: 340, easing: 'ease-out' }
      );
    }
    const rs = Math.max(tick.w, tick.h) || (compact ? 44 : 52);
    const ring = div(
      'cc-ring',
      `left:${tc.x - rs / 2}px;top:${tc.y - rs / 2}px;width:${rs}px;height:${rs}px`
    );
    anim(
      ring,
      [
        { transform: 'scale(1)', opacity: 0.9 },
        { transform: 'scale(2.3)', opacity: 0 },
      ],
      { duration: 480, easing: 'ease-out', fill: 'forwards' }
    );
    for (let k = 0; k < 12; k++) {
      const sp = div('cc-spark', `background:${POD[k % 4]}`);
      const ang = rad(k * 30 + rand(-8, 8));
      const d = rand(34, 66);
      anim(
        sp,
        [
          { transform: `translate(${tc.x}px,${tc.y}px) scale(1)`, opacity: 1 },
          {
            transform: `translate(${tc.x + Math.cos(ang) * d}px,${tc.y + Math.sin(ang) * d}px) scale(.4)`,
            opacity: 0,
          },
        ],
        { duration: 560, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }
      );
    }
  }

  function burst({ tick, area, tickEl, blockEl, late = false }: BurstInput): void {
    if (cancelled) return;
    const tc = center(tick);
    // 1. The tick pops, a ring and pod-colour sparks spring from it, and the stars burst out.
    // Started late, the tick is gone (the banner replaced it): only the stars, no ring or pop.
    if (!late) tickPop(tc, tick, tickEl);
    // The fan aims from the tick toward the middle of the block, so the stars stay on this
    // bean's board instead of spilling off the edge or into a sibling's lane.
    const aim = (Math.atan2(-160, area.x + area.w / 2 - tc.x) * 180) / Math.PI;
    stars = Array.from({ length: count }, (_, k) => {
      const el = div('cc-fstar', `font-size:${fs}px`);
      el.textContent = STAR;
      const spread = count > 1 ? 130 / (count - 1) : 0;
      const ang = rad(aim - 65 + k * spread + rand(-7, 7));
      const d = rand(compact ? 105 : 95, compact ? 150 : 140);
      const bx = Math.min(area.x + area.w - 14, Math.max(area.x + 14, tc.x + Math.cos(ang) * d));
      const by = Math.max(18, tc.y + Math.sin(ang) * d);
      const r = rand(-200, 200);
      anim(
        el,
        [
          { transform: `translate(${tc.x}px,${tc.y}px) scale(.2) rotate(0deg)`, opacity: 0 },
          {
            transform: `translate(${(tc.x + bx) / 2}px,${(tc.y + by) / 2}px) scale(1) rotate(${r / 2}deg)`,
            opacity: 1,
            offset: 0.3,
          },
          {
            transform: `translate(${bx}px,${by}px) scale(1.5) rotate(${r}deg)`,
            opacity: 1,
            offset: 0.75,
          },
          { transform: `translate(${bx}px,${by}px) scale(1.3) rotate(${r}deg)`, opacity: 1 },
        ],
        { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }
      );
      anim(
        el,
        [
          { transform: `translate(${bx}px,${by}px) scale(1.3) rotate(${r}deg)` },
          { transform: `translate(${bx}px,${by - 5}px) scale(1.45) rotate(${r + 14}deg)` },
          { transform: `translate(${bx}px,${by}px) scale(1.3) rotate(${r}deg)` },
        ],
        { duration: 640, delay: 520 + k * 60, iterations: Infinity, easing: 'ease-in-out' }
      );
      return { el, bx, by, r };
    });

    // 2. The block steps aside for the banner (never once the banner is here).
    if (late || arrived) return;
    later(SWAP - 160, () => {
      if (arrived) return;
      aside = anim(
        blockEl,
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(.97)' },
        ],
        { duration: 160, easing: 'ease-in', fill: 'forwards' }
      );
    });
  }

  function arrive(banner: HTMLElement): void {
    if (cancelled) return;
    arrived = true;
    // The block element is the banner's parent now: let it show again.
    aside?.cancel();
    aside = null;
    const picture = q(banner, '[data-celebration-picture]');
    // Measure the settled layout BEFORE any entry transform is applied.
    const B = local(banner);
    const S = picture ? local(picture) : { x: B.x + B.w / 2 - 80, y: B.y + 16, w: 160, h: 62 };
    const slots = qa(banner, '[data-celebration-star]');
    const slotC = slots.map((s) => center(local(s)));
    const W = stage.clientWidth;
    const G: Geometry = { W, B, S, compact, cx: S.x + S.w / 2, foot: S.y + S.h };
    anim(
      banner,
      [
        { opacity: 0, transform: 'scale(.92)' },
        { opacity: 1, transform: 'scale(1.02)', offset: 0.7 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 340, easing: 'ease-out' }
    );

    // The soft glow sits ABOVE the banner's top edge only, so the banner stays crisp and the
    // board behind the beanies quietens down in either theme.
    const clip = div('cc-clip', `width:${W}px;height:${Math.max(0, B.y + 2)}px`);
    const gw = Math.min(W * 1.15, compact ? 620 : 520);
    const gh = compact ? 380 : 320;
    const glow = div(
      'cc-glow',
      `left:${B.x + B.w / 2 - gw / 2}px;top:${B.y - gh / 2}px;width:${gw}px;height:${gh}px`,
      clip
    );
    anim(glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, fill: 'both' });
    anim(glow, [{ opacity: 1 }, { opacity: 0 }], {
      duration: 420,
      delay: at(SETTLE + 60),
      fill: 'forwards',
    });

    // 3. The beanies.
    MOVES[opts.move](G, clip, banner);

    // 4. The praise line pops in word by word on the banner.
    qa(banner, '[data-praise-word]').forEach((w, k) => {
      anim(
        w,
        [
          { opacity: 0, transform: 'translateY(18px) scale(.5) rotate(-6deg)' },
          { opacity: 1, transform: 'translateY(-4px) scale(1.12) rotate(2deg)', offset: 0.6 },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 420,
          delay: at(PRAISE_AT + k * 85),
          easing: 'cubic-bezier(.2,.9,.3,1.2)',
          fill: 'both',
        }
      );
      if (w.dataset.praiseName === 'true') {
        anim(
          w,
          [
            { transform: 'none' },
            { transform: 'scale(1.18) rotate(-4deg)' },
            { transform: 'scale(1.18) rotate(4deg)' },
            { transform: 'none' },
          ],
          { duration: 600, delay: at(PRAISE_AT + 1100), easing: 'ease-in-out' }
        );
      }
    });

    // 5. Each star flies into its place in the banner's star row.
    stars.forEach((st, k) => {
      const end = slotC[k];
      const slot = slots[k];
      if (!end || !slot) {
        anim(st.el, [{ opacity: 1 }, { opacity: 0 }], {
          duration: 300,
          delay: at(FLY + k * FLY_GAP),
          fill: 'forwards',
        });
        return;
      }
      const p0 = { x: st.bx, y: st.by };
      const p1 = {
        x: (p0.x + end.x) / 2 + rand(-40, 40),
        y: Math.min(p0.y, end.y) - (compact ? 90 : 70),
      };
      const kf: Keyframe[] = [];
      for (let j = 0; j <= 10; j++) {
        const t = j / 10;
        const u = 1 - t;
        const x = u * u * p0.x + 2 * u * t * p1.x + t * t * end.x;
        const y = u * u * p0.y + 2 * u * t * p1.y + t * t * end.y;
        const sc = 1.3 + Math.sin(Math.PI * t) * 0.35 - 0.3 * t;
        kf.push({
          transform: `translate(${x}px,${y}px) scale(${sc}) rotate(${st.r + 360 * t}deg)`,
        });
      }
      const a = anim(st.el, kf, {
        duration: 520,
        delay: at(FLY + k * FLY_GAP),
        easing: 'cubic-bezier(.45,0,.25,1)',
        fill: 'forwards',
      });
      if (!a) return;
      a.onfinish = () => {
        if (cancelled) return;
        st.el.remove();
        anim(q(slot, '[data-celebration-star-lit]'), [{ opacity: 0 }, { opacity: 1 }], {
          duration: 1,
          fill: 'forwards',
        });
        twinkle(end.x, end.y, fs * 1.2);
        anim(
          slot,
          [
            { transform: 'scale(.5)' },
            { transform: 'scale(1.45)', offset: 0.55 },
            { transform: 'scale(1)' },
          ],
          { duration: 280, easing: 'ease-out' }
        );
      };
    });

    // 6. Settle into the everyday banner.
    settleWords(banner, SETTLE, SETTLE + 160, 240);
    anim(q(banner, '[data-testid="celebration-banner-action"]'), [{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      delay: at(SETTLE + 260),
      fill: 'forwards',
    });
  }

  /** The praise line fades out and the banner's own words fade back in. */
  function settleWords(banner: HTMLElement, outMs: number, inMs: number, outDur: number): void {
    anim(q(banner, '[data-celebration-praise]'), [{ opacity: 1 }, { opacity: 0 }], {
      duration: outDur,
      delay: at(outMs),
      fill: 'forwards',
    });
    anim(q(banner, '[data-celebration-std]'), [{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      delay: at(inMs),
      fill: 'forwards',
    });
  }

  function calm(banner: HTMLElement): void {
    if (cancelled) return;
    settleWords(banner, BEATS.calmPraiseOut, BEATS.calmStdIn, 300);
  }

  function fadeOutBy(el: HTMLElement, endMs: number): void {
    anim(el, [{ opacity: 1 }, { opacity: 0 }], {
      duration: 300,
      delay: at(endMs - 300),
      fill: 'forwards',
    });
  }

  function follow(dx: number, dy: number): void {
    followed = { dx, dy };
    stage.style.transform = dx || dy ? `translate(${dx}px,${dy}px)` : '';
  }

  function cancel(): void {
    if (cancelled) return;
    cancelled = true;
    timers.forEach(clearTimeout);
    timers = [];
    for (const a of anims) {
      a.onfinish = null;
      a.cancel();
    }
    anims = [];
    stars = [];
    aside = null;
    layer.remove();
    stage.style.transform = '';
  }

  return { burst, arrive, calm, fadeOutBy, follow, cancel };
}
