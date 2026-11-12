/**
 * What sits in which slot of the sleep slideshow (#140), as STATE.
 *
 * The frame used to be a pure function of (rotation index, ready set, deck), so any change to
 * the ready set or the deck re-laid every tile at once. Here each slot remembers what it shows
 * and when it was filled, and two pure steps move it on:
 *
 * - `tickSlides` runs once a rotation. Around the clock, a tile holding a stand-in text (or
 *   nothing) takes a photo if one is ready; otherwise the OLDEST photo tile takes the next
 *   ready photo not on screen. One text slot advances the same way. Full screen, the photo
 *   advances and its pins are re-picked for its own bean. Content that left the pool (a text
 *   deleted, a type switched off) is replaced here, never between rotations.
 * - `fillSlides` runs whenever the inputs change between rotations. It only ever fills an
 *   EMPTY slot (photos in the order they became ready, then texts), so a showing piece never
 *   moves. Its one removal: a photo no longer ready (its `<img>` errored, or left the deck and
 *   was unmounted) leaves at once, since it can no longer be drawn.
 *
 * The walk through the photos and texts is keyed by id in the night's order
 * (`compareNightOrder`), not by a numeric offset, so entries joining or leaving never move it.
 * When nothing new is eligible, a slot keeps what it has and the cursor waits.
 */
import {
  compareNightOrder,
  PLAIN_FRAME,
  type NoteSlotId,
  type PinSlotId,
  type SlidePhoto,
  type SlideshowFrame,
  type SlideshowShape,
  type SlideText,
  type SlideTile,
  type SlotId,
  type TileSlotId,
} from '@/utils/wallSlideshow';
import type { UUID, WallSlideshowMode } from '@/types/models';

/**
 * `tile`: a photo, or a text when no photo can take it. `text-tile`: the portrait wall's last
 * tile, kept for a text memory whenever the family has one. `note` / `pin`: texts only.
 * `photo`: the full-screen photo.
 */
type SlotRole = 'tile' | 'text-tile' | 'note' | 'photo' | 'pin';

export interface SlideSlot {
  id: SlotId;
  role: SlotRole;
  content: SlideTile | null;
  /** The rotation this slot was last filled on: the oldest photo tile is the next to change. */
  filledAt: number;
}

export interface SlideshowSlots {
  /** `mode:shape` the slots are laid out for. A change lays out a fresh set at once. */
  config: string;
  /** Full-screen mode shows the around layout, with texts, while no photo is ready. */
  layout: 'around' | 'full';
  slots: readonly SlideSlot[];
  /** Rotations so far. */
  rotation: number;
  /** The photo the deck walk last took; the next walk starts after it. */
  photoCursor: UUID | null;
  /** The text the text walk last took. */
  textCursor: string | null;
}

export interface SlideInputs {
  mode: WallSlideshowMode;
  shape: SlideshowShape;
  /** The night's seed: the walk order. */
  seed: string;
  /** Tonight's deck (`slideshowDeck`). */
  deck: readonly SlidePhoto[];
  /** Loaded and decoded photos, in the order they became ready. */
  ready: ReadonlySet<UUID>;
  texts: readonly SlideText[];
  /**
   * The loader's first pass has photos still on the way (`!images.settled` with photos
   * mounted). While it does, no tile takes a stand-in text (photos fill them as they arrive)
   * and full screen shows no text fallback, so a night never opens on notes alone.
   */
  photosPending: boolean;
}

/** Before the first `fillSlides`: no slots, so the plain face. */
export const EMPTY_SLIDES: SlideshowSlots = {
  config: '',
  layout: 'around',
  slots: [],
  rotation: 0,
  photoCursor: null,
  textCursor: null,
};

const TILES: readonly TileSlotId[] = ['p1', 'p2', 'p3', 'p4', 'p5'];

/** The slots of each layout, in fill order (`wallMemorySlots.css`, `WallMemoryFull`). */
function layoutSlots(layout: 'around' | 'full', shape: SlideshowShape): SlideSlot[] {
  const slot = (id: SlotId, role: SlotRole): SlideSlot => ({
    id,
    role,
    content: null,
    filledAt: 0,
  });
  if (layout === 'full') return [slot('full', 'photo'), slot('pin1', 'pin'), slot('pin2', 'pin')];
  if (shape === 'portrait') {
    return [...TILES.slice(0, 3).map((id) => slot(id, 'tile')), slot('p4', 'text-tile')];
  }
  return [...TILES.map((id) => slot(id, 'tile')), slot('n1', 'note'), slot('n2', 'note')];
}

/** Drift phase per slot, so a piece's drift follows its slot, never how many are showing. */
export const SLOT_DRIFT_DELAY_S: Readonly<Record<SlotId, number>> = {
  p1: 0,
  p2: -3.1,
  p3: -6.2,
  p4: -9.3,
  p5: -12.4,
  n1: -15.5,
  n2: -18.6,
  full: 0,
  pin1: 0,
  pin2: -5,
};

/** Alternate pieces get tape, by slot. */
export function slotHasTape(slot: SlotId): boolean {
  return ['p1', 'p3', 'p5', 'n1', 'pin1'].includes(slot);
}

const pieceId = (piece: SlideTile): string =>
  piece.kind === 'photo' ? piece.photoId : piece.entry.id;
const momentOf = (photo: SlidePhoto): string => photo.entryId ?? photo.photoId;

interface Draft extends Omit<SlideshowSlots, 'slots'> {
  slots: SlideSlot[];
  inputs: SlideInputs;
}

function draftOf(state: SlideshowSlots, inputs: SlideInputs): Draft {
  return { ...state, slots: state.slots.map((s) => ({ ...s })), inputs };
}

/** The draft as state, or `state` itself when nothing changed (no needless re-render). */
function settle(state: SlideshowSlots, d: Draft): SlideshowSlots {
  const same =
    d.config === state.config &&
    d.layout === state.layout &&
    d.rotation === state.rotation &&
    d.photoCursor === state.photoCursor &&
    d.textCursor === state.textCursor &&
    d.slots.length === state.slots.length &&
    d.slots.every((s, i) => {
      // eslint-disable-next-line security/detect-object-injection -- i is an array index
      const was = state.slots[i]!;
      return s.id === was.id && s.content === was.content && s.filledAt === was.filledAt;
    });
  if (same) return state;
  const { inputs: _inputs, ...next } = d;
  return next;
}

/** Texts only ever come from the text walk, so placing one moves its cursor. */
function put(d: Draft, slot: SlideSlot, piece: SlideTile): void {
  slot.content = piece;
  slot.filledAt = d.rotation;
  if (piece.kind === 'text') d.textCursor = piece.entry.id;
}

/** Can this slot hold a photo with these inputs? */
function takesPhoto(slot: SlideSlot, inputs: SlideInputs): boolean {
  if (slot.role === 'photo') return true;
  if (inputs.mode !== 'around') return false;
  return slot.role === 'tile' || (slot.role === 'text-tile' && inputs.texts.length === 0);
}

/**
 * Can this slot hold a text with these inputs? Tiles only as a stand-in for a photo, and not
 * while photos are still on the way. The note, text-tile and pin slots take texts from the
 * start, except full screen's text fallback, which waits for the first pass to settle.
 */
function takesText(slot: SlideSlot, inputs: SlideInputs): boolean {
  if (slot.role === 'photo') return false;
  if (inputs.photosPending && slot.role !== 'pin') {
    if (inputs.mode === 'full' || slot.role === 'tile') return false;
  }
  return slot.role !== 'text-tile' || inputs.texts.length > 0;
}

function shownIds(d: Draft, kind: SlideTile['kind'], except?: SlideSlot): Set<string> {
  const ids = new Set<string>();
  for (const s of d.slots) {
    if (s !== except && s.content?.kind === kind) ids.add(pieceId(s.content));
  }
  return ids;
}

/** `items` in the night's order, starting just after `cursor` and wrapping. */
function walk<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  seed: string,
  cursor: string | null
): T[] {
  const sorted = [...items].sort((a, b) => compareNightOrder(seed, idOf(a), idOf(b)));
  if (cursor === null) return sorted;
  const at = sorted.findIndex((item) => compareNightOrder(seed, idOf(item), cursor) > 0);
  return at <= 0 ? sorted : [...sorted.slice(at), ...sorted.slice(0, at)];
}

/** Ready deck photos not on screen in another slot, and not in `barred`. */
function eligiblePhotos(d: Draft, slot: SlideSlot | undefined, barred: ReadonlySet<string>) {
  const shown = shownIds(d, 'photo', slot);
  return d.inputs.deck.filter(
    (p) => d.inputs.ready.has(p.photoId) && !shown.has(p.photoId) && !barred.has(p.photoId)
  );
}

/** Moments (milestones) on screen in another slot, for the distinct-moment preference. */
function shownMoments(d: Draft, slot: SlideSlot | undefined): Set<string> {
  const moments = new Set<string>();
  for (const s of d.slots) {
    if (s !== slot && s.content?.kind === 'photo') moments.add(momentOf(s.content));
  }
  return moments;
}

/**
 * The deck walk's next photo for `slot`, preferring a moment not already on screen. When the
 * head of the walk is skipped for that, the cursor stays on it, so it goes up as soon as its
 * moment leaves the screen: the preference never starves a photo.
 */
function nextPhoto(d: Draft, slot: SlideSlot, barred: ReadonlySet<string>): SlidePhoto | null {
  const order = walk(
    eligiblePhotos(d, slot, barred),
    (p) => p.photoId,
    d.inputs.seed,
    d.photoCursor
  );
  const head = order[0];
  if (!head) return null;
  const moments = shownMoments(d, slot);
  const distinct = order.find((p) => !moments.has(momentOf(p)));
  if (distinct && distinct !== head) return distinct;
  d.photoCursor = head.photoId;
  return head;
}

/** A photo for an empty slot between rotations: the earliest to become ready. */
function arrivedPhoto(d: Draft, slot: SlideSlot, barred: ReadonlySet<string>): SlidePhoto | null {
  const eligible = new Map(eligiblePhotos(d, slot, barred).map((p) => [p.photoId, p]));
  const arrivals = [...d.inputs.ready].flatMap((id) => {
    const photo = eligible.get(id);
    return photo ? [photo] : [];
  });
  const moments = shownMoments(d, slot);
  return arrivals.find((p) => !moments.has(momentOf(p))) ?? arrivals[0] ?? null;
}

/** A pin prefers the full-screen photo's own bean. */
function preferredMember(d: Draft, slot: SlideSlot): UUID | null {
  if (slot.role !== 'pin') return null;
  const photo = d.slots.find((s) => s.role === 'photo')?.content;
  return photo?.kind === 'photo' ? photo.memberId : null;
}

/** The text walk's next text for `slot`, not on screen elsewhere and not in `barred`. */
function nextText(d: Draft, slot: SlideSlot, barred: ReadonlySet<string>): SlideText | null {
  const shown = shownIds(d, 'text', slot);
  const eligible = d.inputs.texts.filter((t) => !shown.has(t.entry.id) && !barred.has(t.entry.id));
  const order = walk(eligible, (t) => t.entry.id, d.inputs.seed, d.textCursor);
  const member = preferredMember(d, slot);
  return (member !== null && order.find((t) => t.memberId === member)) || order[0] || null;
}

/** Point every piece at the current object for its id, so an edited note shows its edit. */
function refresh(d: Draft): void {
  const photos = new Map(d.inputs.deck.map((p) => [p.photoId, p]));
  const texts = new Map(d.inputs.texts.map((t) => [t.entry.id, t]));
  for (const s of d.slots) {
    if (!s.content) continue;
    const id = pieceId(s.content);
    const now = s.content.kind === 'photo' ? photos.get(id) : texts.get(id);
    if (now) s.content = now;
  }
}

/** A photo that can no longer be drawn (not ready, or out of the deck) leaves at once. */
function dropUndrawable(d: Draft): void {
  const deck = new Set(d.inputs.deck.map((p) => p.photoId));
  for (const s of d.slots) {
    if (s.content?.kind !== 'photo') continue;
    const id = s.content.photoId;
    if (!d.inputs.ready.has(id) || !deck.has(id)) s.content = null;
  }
}

/** At a rotation: also replace texts that left the pool and pieces the slot no longer takes. */
function dropDeparted(d: Draft): void {
  dropUndrawable(d);
  const texts = new Set(d.inputs.texts.map((t) => t.entry.id));
  for (const s of d.slots) {
    if (!s.content) continue;
    const gone = s.content.kind === 'text' && !texts.has(s.content.entry.id);
    // A text already up stays while late photos load: `photosPending` only stops NEW stand-ins.
    const holding = { ...d.inputs, photosPending: false };
    const refused = s.content.kind === 'photo' ? !takesPhoto(s, d.inputs) : !takesText(s, holding);
    if (gone || refused) s.content = null;
  }
}

function hasReadyPhoto(inputs: SlideInputs): boolean {
  return inputs.deck.some((p) => inputs.ready.has(p.photoId));
}

/**
 * Lay out a fresh set of slots when the mode or shape changed (at once), or when full screen
 * gains its first ready photo or loses its last one. That switch waits for a rotation unless
 * the screen has nothing on it, or the full photo is gone and nothing can replace it.
 */
function ensureLayout(d: Draft, atTick: boolean): boolean {
  const { mode, shape } = d.inputs;
  const config = `${mode}:${shape}`;
  const want = mode === 'full' && hasReadyPhoto(d.inputs) ? 'full' : 'around';
  const empty = d.slots.every((s) => s.content === null);
  const photoGone = d.layout === 'full' && !d.slots.some((s) => s.content?.kind === 'photo');
  const relayout = d.config !== config || (want !== d.layout && (atTick || empty || photoGone));
  if (!relayout) return false;
  d.config = config;
  d.layout = want;
  d.slots = mode === 'off' ? [] : layoutSlots(want, shape);
  return true;
}

/**
 * Fill empty slots only: photos first, then texts. A text tile or pin always takes its text
 * first, so it never waits behind a stand-in. Then, with a photo up, the note slots take
 * texts before tiles take stand-ins; with none, texts fill the large tiles first (the mockup).
 * `barred`: pieces that left the screen this rotation, which may not reappear elsewhere.
 */
function fillEmpty(d: Draft, barred: ReadonlySet<string> = new Set()): void {
  for (const s of d.slots) {
    if (s.content || !takesPhoto(s, d.inputs)) continue;
    const photo = arrivedPhoto(d, s, barred);
    if (photo) put(d, s, photo);
  }
  const photoUp = d.slots.some((s) => s.content?.kind === 'photo');
  const roles: readonly SlotRole[][] = [
    ['text-tile', 'pin'],
    ...(photoUp ? [['note'], ['tile']] : [['tile'], ['note']]),
  ] as SlotRole[][];
  for (const pass of roles) {
    for (const s of d.slots) {
      if (s.content || !pass.includes(s.role) || !takesText(s, d.inputs)) continue;
      const text = nextText(d, s, barred);
      if (text) put(d, s, text);
    }
  }
}

function oldest(slots: readonly SlideSlot[]): SlideSlot | undefined {
  return slots.reduce<SlideSlot | undefined>(
    (best, s) => (!best || s.filledAt < best.filledAt ? s : best),
    undefined
  );
}

/** Around: stand-in texts give way to ready photos; failing that, the oldest photo moves on. */
function advanceAroundPhotos(d: Draft, barred: ReadonlySet<string>, changed: Set<SlotId>): void {
  const tiles = d.slots.filter((s) => takesPhoto(s, d.inputs));
  for (const s of tiles) {
    if (s.content?.kind === 'photo') continue;
    const photo = nextPhoto(d, s, barred);
    if (!photo) break;
    put(d, s, photo);
    changed.add(s.id);
  }
  if (changed.size > 0) return;
  const slot = oldest(tiles.filter((s) => s.content?.kind === 'photo'));
  const photo = slot && nextPhoto(d, slot, barred);
  if (slot && photo) {
    put(d, slot, photo);
    changed.add(slot.id);
  }
}

/**
 * Full: the next photo. A pin showing another bean's text gives way to one of the new photo's
 * bean when there is one; a pin that already fits, or has nothing better, stays as it is.
 */
function advanceFullPhoto(d: Draft, barred: ReadonlySet<string>, changed: Set<SlotId>): void {
  const slot = d.slots.find((s) => s.role === 'photo');
  const photo = slot && nextPhoto(d, slot, barred);
  if (!slot || !photo) return;
  put(d, slot, photo);
  changed.add(slot.id);
  if (photo.memberId === null) return;
  for (const pin of d.slots) {
    if (pin.role !== 'pin' || pin.content?.memberId === photo.memberId) continue;
    const text = nextText(d, pin, barred);
    if (text?.memberId !== photo.memberId) continue;
    put(d, pin, text);
    changed.add(pin.id);
  }
}

/**
 * One text slot, the oldest one not changed this rotation, takes the next text. Full screen,
 * a pin showing another bean than the photo goes first, and a pin that matches the photo only
 * ever gives way to another text of that bean, never to someone else's.
 */
function advanceText(d: Draft, barred: ReadonlySet<string>, changed: ReadonlySet<SlotId>): void {
  const texts = d.slots.filter((s) => s.content?.kind === 'text' && !changed.has(s.id));
  const offBean = texts.filter((s) => {
    const member = preferredMember(d, s);
    return member !== null && s.content?.memberId !== member;
  });
  const slot = oldest(offBean.length > 0 ? offBean : texts);
  const text = slot && nextText(d, slot, barred);
  if (!slot || !text) return;
  const member = preferredMember(d, slot);
  if (member !== null && slot.content?.memberId === member && text.memberId !== member) return;
  put(d, slot, text);
}

/** Between rotations: fill empty slots, never moving a piece that is showing. */
export function fillSlides(state: SlideshowSlots, inputs: SlideInputs): SlideshowSlots {
  const d = draftOf(state, inputs);
  refresh(d);
  dropUndrawable(d);
  ensureLayout(d, false);
  fillEmpty(d);
  return settle(state, d);
}

/** One rotation: one photo slot and one text slot move on (see the file comment). */
export function tickSlides(state: SlideshowSlots, inputs: SlideInputs): SlideshowSlots {
  const d = draftOf(state, inputs);
  d.rotation += 1;
  refresh(d);
  // What was on screen as the rotation began may not come straight back in another slot,
  // unless the whole layout changed (that crossfades every piece anyway).
  const shown = d.slots.flatMap((s) => (s.content ? [pieceId(s.content)] : []));
  dropDeparted(d);
  const barred = new Set(ensureLayout(d, true) ? [] : shown);
  const changed = new Set<SlotId>();
  if (d.layout === 'full') advanceFullPhoto(d, barred, changed);
  else advanceAroundPhotos(d, barred, changed);
  advanceText(d, barred, changed);
  fillEmpty(d, barred);
  return settle(state, d);
}

/** The frame the stage draws, read from the slots. A photo not ready is never in it. */
export function slideshowFrame(state: SlideshowSlots, ready: ReadonlySet<UUID>): SlideshowFrame {
  const live = state.slots.filter(
    (s) => s.content && (s.content.kind === 'text' || ready.has(s.content.photoId))
  );
  if (state.layout === 'full') {
    const photo = live.find((s) => s.role === 'photo')?.content;
    if (photo?.kind !== 'photo') return PLAIN_FRAME;
    const pins = live.flatMap((s) =>
      s.content?.kind === 'text' ? [{ slot: s.id as PinSlotId, piece: s.content }] : []
    );
    return { layout: 'full', photo, pins };
  }
  if (live.length === 0) return PLAIN_FRAME;
  const photos = live.flatMap((s) =>
    s.content?.kind === 'photo' ? [{ slot: s.id as TileSlotId, piece: s.content }] : []
  );
  const texts = live.flatMap((s) =>
    s.content?.kind === 'text' ? [{ slot: s.id as TileSlotId | NoteSlotId, piece: s.content }] : []
  );
  return { layout: 'around', photos, texts };
}
