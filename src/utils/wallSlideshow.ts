/**
 * The sleep slideshow on the beanie wall's night face (#140): pure rules, so the stage
 * component and `useWallSlideshow` read one definition of what shows and where.
 *
 * `buildSlideshowPool` turns the family's memories into the night's candidates: every photo
 * (milestone photos, bean avatars, recipe dish photos) and every text memory, each in an
 * order fixed by the night's seed (`compareNightOrder`). `slideshowDeck` takes the deck from
 * the front of the photos, skipping any the loader has given up on. What sits in which slot
 * is STATE, not a function of the deck: see `wallSlideshowSlots.ts`.
 */
import { enabledScrapTypes, photosEnabled } from '@/utils/wallMemories';
import { stableIndex } from '@/utils/stableVariant';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import type {
  Milestone,
  ScrapType,
  UUID,
  WallMemoriesSettings,
  WallSlideshowMode,
} from '@/types/models';

/**
 * How many photos one night keeps decoded. Two dozen 1280 px bitmaps is on the order of
 * 100 MB, and a tab kill on an old tablet empties the deck, so it starts small.
 */
export const WALL_SLIDESHOW_DECK_MAX = 12;

/** Buckets for the seeded order. Prime, so the hash spreads; ties fall back to the id. */
const ORDER_BUCKETS = 10_007;

export type TextScrapType = Exclude<ScrapType, 'milestone'>;

/** The wall's orientation, from the same signal that sets `.wall-portrait`. */
export type SlideshowShape = 'landscape' | 'portrait';

/** Slots a photo can take (`wallMemorySlots.css`): the around tiles, or the whole screen. */
export type TileSlotId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5';
export type PhotoSlotId = TileSlotId | 'full';
/** Small note slots around the clock, and the full-screen photo's two corner pins. */
export type NoteSlotId = 'n1' | 'n2';
export type PinSlotId = 'pin1' | 'pin2';
export type SlotId = PhotoSlotId | NoteSlotId | PinSlotId;

export interface SlidePhoto {
  kind: 'photo';
  photoId: UUID;
  /** `null` for a whole-family milestone or a dish. */
  memberId: UUID | null;
  caption?: string;
  source: 'milestone' | 'avatar' | 'dish';
  /**
   * The milestone this photo belongs to, so one frame can prefer photos of different
   * moments (two tiles never both say "Juno turned seven" while others are ready). Unset for
   * an avatar or a dish, which are one photo each.
   */
  entryId?: string;
}

/** A favorite, saying or note, as a text piece on the night face. */
export interface SlideText {
  kind: 'text';
  memberId: UUID | null;
  entry: ScrapbookEntry & { type: TextScrapType };
}

/** Around the clock, a tile slot holds a photo, or a text piece when no photo is ready. */
export type SlideTile = SlidePhoto | SlideText;

export interface SlideshowPool {
  /** Every candidate photo in the night's order; `slideshowDeck` cuts the deck from it. */
  photos: SlidePhoto[];
  texts: SlideText[];
}

/** One piece in one slot. A slot's identity is what lets a showing piece stay put. */
export interface Placed<T extends SlideTile, S extends SlotId> {
  slot: S;
  piece: T;
}

/**
 * What the night face shows, read from the slot state (`slideshowFrame`). Around the clock,
 * photos sit in tile slots and text pieces in note slots or in a tile no photo could take.
 */
export type SlideshowFrame =
  | { layout: 'plain' }
  | {
      layout: 'around';
      photos: Placed<SlidePhoto, TileSlotId>[];
      texts: Placed<SlideText, TileSlotId | NoteSlotId>[];
    }
  | { layout: 'full'; photo: SlidePhoto; pins: Placed<SlideText, PinSlotId>[] };

/** A photo the caller found on a bean (avatar) or a recipe (dish). */
export interface SlidePhotoCandidate {
  photoId: UUID;
  memberId: UUID | null;
  caption?: string;
}

export interface SlideshowPoolInput {
  settings: WallMemoriesSettings;
  /** The scrapbook feed for EVERY type; this function applies the enabled types. */
  entries: readonly ScrapbookEntry[];
  avatars: readonly SlidePhotoCandidate[];
  dishes: readonly SlidePhotoCandidate[];
  /** False for a PDF, a missing or a deleted photo. Applied to all three sources. */
  isImage: (photoId: UUID) => boolean;
  /** The night's seed, captured once, so midnight neither reshuffles nor refetches. */
  seed: string;
}

export const EMPTY_SLIDESHOW_POOL: Readonly<SlideshowPool> = { photos: [], texts: [] };

/** The night face with no memories on it. */
export const PLAIN_FRAME: SlideshowFrame = { layout: 'plain' };

/**
 * The night's order of two ids: seeded hash first, the id breaking ties. A total order on
 * ids alone, so a position in it survives any other id joining or leaving the list.
 */
export function compareNightOrder(seed: string, a: string, b: string): number {
  const rank = (id: string) => stableIndex(`${seed}:${id}`, ORDER_BUCKETS);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** `items` in the night's order. */
function seededOrder<T>(items: readonly T[], seed: string, idOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareNightOrder(seed, idOf(a), idOf(b)));
}

function milestonePhotos(entries: readonly ScrapbookEntry[]): SlidePhoto[] {
  const out: SlidePhoto[] = [];
  for (const entry of entries) {
    if (entry.type !== 'milestone') continue;
    const milestone = entry.payload as Milestone;
    for (const photoId of milestone.photoIds ?? []) {
      out.push({
        kind: 'photo',
        photoId,
        memberId: entry.memberId,
        caption: milestone.title,
        source: 'milestone',
        entryId: entry.id,
      });
    }
  }
  return out;
}

function candidatePhotos(
  candidates: readonly SlidePhotoCandidate[],
  source: 'avatar' | 'dish'
): SlidePhoto[] {
  return candidates.map((c) => ({ kind: 'photo', ...c, source }));
}

/** The night's photos: images only, one per photo id (the first source wins), in order. */
function poolPhotos(input: SlideshowPoolInput): SlidePhoto[] {
  if (!photosEnabled(input.settings)) return [];
  const all = [
    ...milestonePhotos(input.entries),
    ...candidatePhotos(input.avatars, 'avatar'),
    ...candidatePhotos(input.dishes, 'dish'),
  ];
  const byId = new Map<UUID, SlidePhoto>();
  for (const photo of all) {
    if (!byId.has(photo.photoId) && input.isImage(photo.photoId)) byId.set(photo.photoId, photo);
  }
  return seededOrder([...byId.values()], input.seed, (p) => p.photoId);
}

/** The night's text memories, of the enabled text types only. */
function poolTexts(input: SlideshowPoolInput): SlideText[] {
  // The feed was asked for every type, and its empty set means "all": filter here.
  const types = enabledScrapTypes(input.settings);
  const texts: SlideText[] = [];
  for (const entry of input.entries) {
    if (entry.type === 'milestone' || !types.has(entry.type)) continue;
    texts.push({ kind: 'text', memberId: entry.memberId, entry: entry as SlideText['entry'] });
  }
  return seededOrder(texts, input.seed, (t) => t.entry.id);
}

/** Everything the slideshow could show tonight, in the night's order. */
export function buildSlideshowPool(input: SlideshowPoolInput): SlideshowPool {
  return { photos: poolPhotos(input), texts: poolTexts(input) };
}

/**
 * The night's deck: the first `WALL_SLIDESHOW_DECK_MAX` candidates not given up on, in the
 * night's order, so a dead photo's slot goes to the next candidate. Given-up photos are kept
 * at the back only when the candidates run out, where they go on retrying as before.
 */
export function slideshowDeck<T extends { photoId: UUID }>(
  candidates: readonly T[],
  givenUp: ReadonlySet<UUID>
): T[] {
  const live = candidates.filter((c) => !givenUp.has(c.photoId));
  const dead = candidates.filter((c) => givenUp.has(c.photoId));
  return [...live, ...dead].slice(0, WALL_SLIDESHOW_DECK_MAX);
}

/** Is this an around frame with no photo in it (the text-only fallback)? */
export function isTextOnlyFrame(frame: SlideshowFrame): boolean {
  return frame.layout === 'around' && frame.photos.length === 0;
}

export type SlideshowFallbackReason = 'no-photos' | 'none-ready' | 'types-off' | 'error';

export interface SlideshowFallback {
  kind: 'plain' | 'text-only';
  reason: SlideshowFallbackReason;
}

export interface SlideshowFallbackInput {
  mode: WallSlideshowMode;
  frame: SlideshowFrame;
  pool: SlideshowPool;
  settings: WallMemoriesSettings;
  /** Building the pool or the frame threw. */
  error: boolean;
  /** The first loading pass has finished, so "none ready" is a result, not a wait. */
  settled: boolean;
}

/**
 * Why the night face is showing less than photos, for the `wall_slideshow_fallback` event;
 * `null` when it is not (photos on screen, mode Off, or photos still loading).
 */
export function slideshowFallback(input: SlideshowFallbackInput): SlideshowFallback | null {
  if (input.mode === 'off') return null;
  if (input.error) return { kind: 'plain', reason: 'error' };
  const kind =
    input.frame.layout === 'plain' ? 'plain' : isTextOnlyFrame(input.frame) ? 'text-only' : null;
  if (kind === null) return null;
  if (!photosEnabled(input.settings)) return { kind, reason: 'types-off' };
  if (input.pool.photos.length === 0) return { kind, reason: 'no-photos' };
  return input.settled ? { kind, reason: 'none-ready' } : null;
}
