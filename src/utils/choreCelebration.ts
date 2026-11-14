/**
 * The choreboard's all-done celebration (#146): the rules, the data, nothing that draws or plays.
 *
 * A bean ticks the last chore of a block: one star per chore bursts from that tick and flies into
 * the banner's star row, the beanies do the day's move above the banner, a praise line pops in,
 * and about three seconds later it settles into the everyday all-done banner. The owner approved
 * the moves, timings and sounds by eye and ear from the v4 mockup
 * (`~/projects/beanies-ops/docs/mockups/chore-celebration-v4-2026-11-14.html`), so the beats and
 * moves below are the mockup's. The sounds are not paired with the moves: all eight rotate.
 *
 * Who uses what:
 *  - `useCelebration` picks the move, the sound and the praise line (`moveForDate`,
 *    `pickChoreSound`, `pickPraiseIndex`) and runs the two phase timers;
 *  - `useSounds` plays the sound;
 *  - `ChoreCelebration.vue` (lazy) draws it, anchored by `choreCelebrationAnchor`;
 *  - the three tick surfaces (the bean's day, the home card, the wall's lanes) build the anchor.
 */
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreBlock } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

// ── Moves and sounds ────────────────────────────────────────────────────────

/** The seven moves, one per weekday (Monday first, as the mockup lists them). */
export const CHORE_MOVES = [
  'bounce-party',
  'peek-a-boo',
  'parade',
  'drop-in',
  'tumble-in',
  'stadium-wave',
  'parachutes',
] as const;
export type ChoreMoveId = (typeof CHORE_MOVES)[number];

/** The seven synthesized sounds. */
export const SYNTH_CELEBRATION_SOUNDS = [
  'marimba',
  'tada',
  'fanfare',
  'strum',
  'glock',
  'pizz',
  'toot',
] as const;
export type SynthCelebrationSoundId = (typeof SYNTH_CELEBRATION_SOUNDS)[number];

/** The eighth sound: the owner's recording of children cheering. */
export const CHEER_SOUND = 'kids-cheer';
export type ChoreSoundId = SynthCelebrationSoundId | typeof CHEER_SOUND;

/** All eight sounds in the rotation, the cheer as one among equals. */
export const CHORE_SOUNDS: readonly ChoreSoundId[] = [...SYNTH_CELEBRATION_SOUNDS, CHEER_SOUND];

/** `Date#getDay` order (Sunday = 0): Mon Bounce party ... Sun Parachutes. */
const MOVE_BY_WEEKDAY: readonly ChoreMoveId[] = [
  'parachutes',
  'bounce-party',
  'peek-a-boo',
  'parade',
  'drop-in',
  'tumble-in',
  'stadium-wave',
];

/** The day's move, by the DEVICE's local weekday (never the family's home zone). */
export function moveForDate(date: Date): ChoreMoveId {
  return MOVE_BY_WEEKDAY[date.getDay()] ?? 'bounce-party';
}

/**
 * How many recently played sounds sit out the next pick. With eight sounds and four sitting out,
 * no sound repeats within five celebrations on one device.
 */
export const RECENT_SOUNDS = 4;

/**
 * The sound for this celebration, independent of the weekday's move: uniformly at random among
 * the sounds NOT in `recent` (the last played, most recent first). A shuffle-bag feel without a
 * bag: by symmetry each sound, the cheer included, comes up one time in eight in the long run.
 */
export function pickChoreSound(
  recent: readonly ChoreSoundId[],
  random: () => number = Math.random
): ChoreSoundId {
  return pickFrom(CHORE_SOUNDS, recent, random);
}

/**
 * The synthesized sound that stands in when the cheer was picked but its recording is not ready:
 * the same rule over the seven synthesized sounds (the cheer and the recent ones sit out).
 */
export function pickStandInSound(
  recent: readonly ChoreSoundId[],
  random: () => number = Math.random
): SynthCelebrationSoundId {
  return pickFrom(SYNTH_CELEBRATION_SOUNDS, recent, random);
}

function pickFrom<T extends ChoreSoundId>(
  pool: readonly T[],
  recent: readonly ChoreSoundId[],
  random: () => number
): T {
  const fresh = pool.filter((id) => !recent.includes(id));
  const from = fresh.length ? fresh : pool;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))]!;
}

/** The history after `id` STARTED: most recent first, no duplicates, at most `RECENT_SOUNDS`. */
export function withPlayedSound(recent: readonly ChoreSoundId[], id: ChoreSoundId): ChoreSoundId[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_SOUNDS);
}

/**
 * A stored history read back: an array of sound ids, unknown ids and duplicates dropped, at most
 * `RECENT_SOUNDS`. Anything else (corrupt JSON already parsed, a hand edit) reads as none.
 */
export function parseSoundHistory(value: unknown): ChoreSoundId[] {
  if (!Array.isArray(value)) return [];
  const out: ChoreSoundId[] = [];
  for (const v of value) {
    if (isChoreSoundId(v) && !out.includes(v)) out.push(v);
    if (out.length === RECENT_SOUNDS) break;
  }
  return out;
}

/** Narrow a stored value back to a sound id (a stale or hand-edited key reads as none). */
export function isChoreSoundId(value: unknown): value is ChoreSoundId {
  return value === CHEER_SOUND || (SYNTH_CELEBRATION_SOUNDS as readonly unknown[]).includes(value);
}

// ── Praise ──────────────────────────────────────────────────────────────────

/**
 * The six praise lines (the mockup's PRAISE). Placeholders: `{name}` (the bean's first name),
 * `{block}` (the block's label, "Morning") and `{blockWord}` (the block inside a sentence,
 * "morning"). "What a morning" has no Anytime reading, so it is for the timed blocks only.
 */
export const CHORE_PRAISE: readonly { key: UIStringKey; timedOnly?: boolean }[] = [
  { key: 'choreboard.praise.allDone' },
  { key: 'choreboard.praise.woohoo' },
  { key: 'choreboard.praise.highFive' },
  { key: 'choreboard.praise.didIt' },
  { key: 'choreboard.praise.whatA', timedOnly: true },
  { key: 'choreboard.praise.lookAtYou' },
];

/** A praise line for `block`, never the one shown last (`last`, an index into CHORE_PRAISE). */
export function pickPraiseIndex(
  block: ChoreBlock,
  last: number | null,
  random: () => number = Math.random
): number {
  const pool = CHORE_PRAISE.map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== last && !(p.timedOnly && block === 'anytime'))
    .map(({ i }) => i);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? 0;
}

export interface PraiseWord {
  text: string;
  /** This piece IS the bean's name (it gets the little wiggle). */
  name: boolean;
}

/** A praise line: the text (said aloud) and the pieces that pop in one after another. */
export interface Praise {
  text: string;
  words: PraiseWord[];
}

/**
 * Full-width CJK punctuation ends a chunk: a Chinese line pops in phrase by phrase. (A marker
 * split, not a lookbehind, which older iOS WebViews cannot parse.)
 */
const CJK_BREAK = /([，。！？、；：])/gu;
const PHRASE_MARK = '\uE001';
const splitPhrases = (token: string) =>
  token.replace(CJK_BREAK, `$1${PHRASE_MARK}`).split(PHRASE_MARK);
/** Stands in for the name while the template is filled, so only the real name is marked. */
const NAME_MARK = '\uE000';
const ONLY_PUNCT = /^[\p{P}\p{S}]+$/u;

/**
 * Fill a praise template and cut it into its pop-in pieces: words where the language spaces them,
 * phrases (split after full-width punctuation) where it does not. The name is filled as a marker
 * first, so it is marked by WHERE it was filled, never by matching text ("Evening" never wiggles
 * for a bean named Eve). It is always its own piece, whole even with a space in it, and keeps
 * the punctuation that touches it ("Pip!", "Pip！").
 */
export function fillPraise(
  template: string,
  values: { name: string; block: string; blockWord: string }
): Praise {
  const name = values.name;
  const marked = fillTemplate(template, { ...values, name: NAME_MARK });
  const words: PraiseWord[] = [];
  for (const token of marked.split(/\s+/).flatMap(splitPhrases)) {
    if (!token) continue;
    const parts = token.split(NAME_MARK);
    let prefix = '';
    parts.forEach((part, i) => {
      if (i > 0 && name) words.push({ text: prefix + name, name: true });
      prefix = '';
      if (!part) return;
      const last = words[words.length - 1];
      if (ONLY_PUNCT.test(part) && i > 0 && last?.name) last.text += part;
      else if (ONLY_PUNCT.test(part) && i < parts.length - 1) prefix = part;
      else words.push({ text: part, name: false });
    });
  }
  return { text: marked.split(NAME_MARK).join(name), words };
}

/** What a banner shows while it is the one celebrating (`CelebrationBanner`'s `celebration`). */
export interface BannerCelebration {
  words: PraiseWord[];
  /** Reduced motion: the stars are lit and only the words are swapped. */
  calm: boolean;
}

// ── The timeline ────────────────────────────────────────────────────────────

/** The beats, in ms from the tick (the mockup's constants). About three seconds in all. */
export const CHORE_CELEBRATION_BEATS = {
  /** The finished block steps aside and the banner arrives. */
  swap: 560,
  /** The beanies start their move. */
  enter: 600,
  /** The praise line starts popping in. */
  praiseAt: 820,
  /** The first star leaves for the banner's star row. */
  fly: 1250,
  /** Between one star's flight and the next. */
  flyGap: 110,
  /** The praise line gives way to the banner's everyday words. */
  settle: 2560,
  /** Everything is gone and the banner is the everyday banner. */
  done: 3060,
  /** Reduced motion: the praise fades out, the everyday words fade in, then done. */
  calmPraiseOut: 2400,
  calmStdIn: 2550,
  calmDone: 2900,
} as const;

// ── The art ─────────────────────────────────────────────────────────────────

export interface CelebrationArt {
  src: string;
  /** Natural size, for the aspect ratio. */
  w: number;
  h: number;
}

const ART_DIR = '/brand/celebration';

/**
 * The real brand art the mockup used: the four holding hands (always one piece), the five dancers
 * cut from the celebrating circle, and the family peeking over a wall. Masters live in
 * `packages/brand/assets/shared/celebration/` (synced into `public/brand/` by
 * `scripts/sync-brand-assets.mjs`) and are precached for offline.
 */
export const CHORE_CELEBRATION_ART = {
  line: { src: `${ART_DIR}/celebrating-line.webp`, w: 542, h: 210 },
  peek: { src: `${ART_DIR}/peek-family.webp`, w: 768, h: 355 },
  dancers: [
    { src: `${ART_DIR}/dancer-0.webp`, w: 187, h: 221 },
    { src: `${ART_DIR}/dancer-1.webp`, w: 198, h: 215 },
    { src: `${ART_DIR}/dancer-2.webp`, w: 205, h: 192 },
    { src: `${ART_DIR}/dancer-3.webp`, w: 188, h: 228 },
    { src: `${ART_DIR}/dancer-4.webp`, w: 204, h: 212 },
  ],
} as const satisfies {
  line: CelebrationArt;
  peek: CelebrationArt;
  dancers: readonly CelebrationArt[];
};

export function choreCelebrationArtUrls(): string[] {
  const a = CHORE_CELEBRATION_ART;
  return [a.line.src, a.peek.src, ...a.dancers.map((d) => d.src)];
}

// ── The anchor ──────────────────────────────────────────────────────────────

export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a celebration plays, captured by the tick surface at the moment of the tap. The overlay
 * lives in App.vue, outside the chore components, so this is everything it needs from them.
 *
 * Rects are viewport pixels measured at the tap. The tick may be gone by play time (the banner
 * replaces the rows), so its rect travels as a number; the block element travels as itself, so
 * the overlay can find the banner inside it and correct for any scroll since the tap.
 */
export interface ChoreCelebrationAnchor {
  /** The block's element on the surface that ticked. */
  block: HTMLElement;
  /** The block's rect at the tap. */
  blockAt: RectLike;
  /** The tick that finished the block (for its little pop), when it is still mounted. */
  tickEl: HTMLElement | null;
  /** The tick's rect at the tap: where the stars burst from. */
  tick: RectLike;
  /**
   * What the celebration is clipped to: the wall's lane, so nothing crosses into a sibling's
   * lane, or the page. Nearest `[data-celebration-clip]` ancestor; null = the viewport.
   */
  clip: HTMLElement | null;
  /** The wall's sizing (a compact banner in a lane), as the mockup's wall frame. */
  compact: boolean;
}

export function rectOf(el: Element): RectLike {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * Build the anchor at tap time: two rect reads, nothing written. `tickEl` may be null (a tick
 * that is not on screen); the block's centre then stands in for it.
 */
export function choreCelebrationAnchor(
  block: HTMLElement,
  tickEl: HTMLElement | null,
  compact = false
): ChoreCelebrationAnchor {
  const blockAt = rectOf(block);
  const tick = tickEl
    ? rectOf(tickEl)
    : { x: blockAt.x + blockAt.w / 2 - 22, y: blockAt.y + blockAt.h / 2 - 22, w: 44, h: 44 };
  return {
    block,
    blockAt,
    tickEl,
    tick,
    clip: block.closest<HTMLElement>('[data-celebration-clip]'),
    compact,
  };
}

/** The page's chore tick for `choreId` inside a block (the day's section, the home card's row). */
export function choreTickSelector(choreId: string): string {
  return `[data-chore-id="${CSS.escape(choreId)}"] [data-testid="chore-tick"]`;
}

/**
 * The ONE tap-time anchor for a tick surface: `block` is the block's element, `tickSelector`
 * finds the tapped tick inside it. Null when the block is not on screen (no celebration anchor:
 * it plays centered).
 */
export function choreTickAnchor(
  block: HTMLElement | null | undefined,
  tickSelector: string,
  compact = false
): ChoreCelebrationAnchor | null {
  if (!block) return null;
  return choreCelebrationAnchor(block, block.querySelector<HTMLElement>(tickSelector), compact);
}
