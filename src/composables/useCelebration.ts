import { markRaw, ref, shallowRef } from 'vue';
import {
  cancelChoreCelebrationSound,
  playChime,
  playChoreCelebrationSound,
  playFanfare,
} from '@/composables/useSounds';
import { useTranslationStore } from '@/stores/translationStore';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import {
  CHORE_CELEBRATION_BEATS as BEATS,
  CHORE_PRAISE,
  SOUND_FOR_MOVE,
  fillPraise,
  isChoreSoundId,
  moveForDate,
  pickChoreSound,
  pickPraiseIndex,
  type BannerCelebration,
  type ChoreCelebrationAnchor,
  type ChoreMoveId,
  type ChoreSoundId,
  type PraiseWord,
} from '@/utils/choreCelebration';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreBlock } from '@/types/models';

/**
 * `shower` is a full-viewport, `pointer-events: none`, self-dismissing
 * celebration. Unlike `modal` it can never sit unattended waiting for a
 * dismissal that never comes, and it never blocks a tap — which is what makes
 * it the right shape for a shared screen (the beanie wall) as well as a phone.
 *
 * The choreboard's all-done celebration is not one of these: it has its own
 * entry point (`celebrateChore` below), anchored to the board.
 */
type CelebrationType = 'toast' | 'modal' | 'shower';

export type CelebrationTrigger =
  | 'setup-complete'
  | 'first-account'
  | 'first-transaction'
  | 'goal-reached'
  | 'goal-milestone'
  | 'first-save'
  | 'debt-free'
  | 'recipe-5star'
  | 'list-complete'
  | 'deck-dealt'
  | 'check-in-done';

interface Celebration {
  id: number;
  type: CelebrationType;
  message: string;
  asset: string;
  onUndo?: () => void;
}

let nextId = 0;

// Module-level state — shared across all callers so stores can trigger celebrations
const toasts = ref<Celebration[]>([]);
const activeModal = ref<Celebration | null>(null);
const activeShower = ref<Celebration | null>(null);

/**
 * How the CURRENT surface wants celebrations to behave. Two neutral options,
 * no per-trigger special-casing and no knowledge of any particular screen, so
 * any future unattended surface (kiosk, presentation, cook mode) can reuse it.
 *
 * `<CelebrationOverlay>` renders in `App.vue`, OUTSIDE any feature's component
 * tree, so a feature cannot hide or time-out a celebration from its own
 * components — it has to ask the owner. That is what this is for.
 */
const mode = ref<{
  autoDismissMs: number | null;
  allowUndo: boolean;
  suppressRoutine: boolean;
}>({
  autoDismissMs: null,
  allowUndo: true,
  suppressRoutine: false,
});

const DEFAULT_MODE = { autoDismissMs: null, allowUndo: true, suppressRoutine: false } as const;
/** Duration a shower stays on screen when the surface does not override it. */
export const SHOWER_DURATION_MS = 4200;
/**
 * A shower carrying an Undo stays up longer. Swapping list completion from the
 * indefinite modal to the self-dismissing shower silently cut the undo window
 * for every user from "until you dismiss it" to 4.2 seconds — long enough to
 * enjoy the beans, not long enough to notice you ticked the wrong list.
 */
export const SHOWER_UNDO_DURATION_MS = 9000;

export function setCelebrationMode(next: Partial<typeof mode.value>): void {
  mode.value = { ...mode.value, ...next };
}

export function resetCelebrationMode(): void {
  mode.value = { ...DEFAULT_MODE };
}

const configs: Record<
  CelebrationTrigger,
  { type: CelebrationType; messageKey: UIStringKey; asset: string }
> = {
  'setup-complete': {
    type: 'modal',
    messageKey: 'celebration.setupComplete',
    asset: '/brand/beanies_celebrating_line_transparent_560x225.png',
  },
  'first-account': {
    type: 'modal',
    messageKey: 'celebration.firstAccount',
    asset: '/brand/beanies_celebrating_circle_transparent_300x300.png',
  },
  'first-transaction': {
    type: 'toast',
    messageKey: 'celebration.firstTransaction',
    asset: '/brand/beanies_celebrating_circle_transparent_300x300.png',
  },
  'goal-reached': {
    type: 'modal',
    messageKey: 'celebration.goalReached',
    asset: '/brand/beanies_celebrating_line_transparent_560x225.png',
  },
  'first-save': {
    type: 'toast',
    messageKey: 'celebration.firstSave',
    asset: '/brand/beanies_celebrating_circle_transparent_300x300.png',
  },
  'debt-free': {
    type: 'modal',
    messageKey: 'celebration.debtFree',
    asset: '/brand/beanies_celebrating_line_transparent_560x225.png',
  },
  'recipe-5star': {
    type: 'toast',
    messageKey: 'celebration.recipe5Star',
    asset: '/brand/beanies_celebrating_circle_transparent_300x300.png',
  },
  'list-complete': {
    type: 'shower',
    messageKey: 'celebration.listComplete',
    asset: '/brand/beanies_celebrating_line_transparent_560x225.png',
  },
  'goal-milestone': {
    type: 'toast',
    messageKey: 'celebration.goalMilestone',
    asset: '/brand/beanies_celebrating_circle_transparent_300x300.png',
  }, // Who Owns What (#109): every kept card has a holder. Fired on the TRANSITION inside the
  // store action that made it true, never from a watcher, so a reload never replays it.
  'deck-dealt': {
    type: 'shower',
    messageKey: 'celebration.deckDealt',
    asset: '/brand/beanies_celebrating_line_transparent_560x225.png',
  },
  'check-in-done': {
    type: 'toast',
    messageKey: 'celebration.checkInDone',
    asset: '/brand/beanies_celebrating_circle_transparent_300x300.png',
  },
};

export function celebrate(trigger: CelebrationTrigger, options?: { onUndo?: () => void }): void {
  const config = configs[trigger];
  if (!config) return;

  /**
   * A surface that gives its own per-action feedback opts out of the routine
   * ones. The beanie wall pops beans out of the tick itself, so the app-level
   * `goal-reached` MODAL on every chore tick was pure harm: a full-viewport
   * black scrim over a shared always-on screen, swallowing the next child's
   * tap. Showers still fire — finishing a whole list is not routine.
   */
  if (mode.value.suppressRoutine && config.type !== 'shower') return;

  // Resolve translation at call time (store is initialized by this point)
  const translationStore = useTranslationStore();
  const message = translationStore.t(config.messageKey);

  const celebration: Celebration = {
    id: nextId++,
    type: config.type,
    message,
    asset: config.asset,
    onUndo: options?.onUndo,
  };

  if (config.type === 'toast') {
    toasts.value.push(celebration);
    playChime();
    setTimeout(() => {
      toasts.value = toasts.value.filter((c) => c.id !== celebration.id);
    }, 4000);
  } else if (config.type === 'shower') {
    // Self-dismissing by design: nothing on an unattended screen should wait
    // for a human to close it. The overlay clears the timer on unmount so a
    // timer never outlives the celebration it belongs to.
    activeShower.value = celebration;
    playFanfare();
  } else {
    activeModal.value = celebration;
    playFanfare();
  }
}

// ── The chore celebration (#146) ────────────────────────────────────────────

export const CHORE_CELEBRATION_SURFACE = 'chore-celebration';

export interface ChoreCelebrationRequest {
  memberId: string;
  block: ChoreBlock;
  /** The bean's first name, for the praise line. */
  beanName: string;
  /** Chores in the block: one star each. */
  count: number;
  /**
   * Where the last tick was, from the surface that ticked it. Absent (a tick from a surface with
   * no board on screen) plays a centered version of the same move.
   */
  anchor?: ChoreCelebrationAnchor | null;
  /**
   * Is the block still all done? Asked when the banner is due: a bean who unticks a chore during
   * the burst (a double tap) gets no banner over an undone block; the celebration ends quietly.
   */
  stillDone?: () => boolean;
  /**
   * No burst from the tick (it is gone, or long ago): the move plays on the banner straight
   * away. For a block found done only after another device's tick, a commit that took long, or a
   * tick no longer on screen.
   */
  settled?: boolean;
}

/**
 * `burst`: the tick pops and the stars fly out; the block still shows its rows.
 * `banner`: the banner has arrived (in its celebrating form) and the beanies do their move.
 */
export type ChoreCelebrationPhase = 'burst' | 'banner';

export interface ActiveChoreCelebration extends ChoreCelebrationRequest {
  /** `member:block`: one celebration per bean and block at a time. */
  key: string;
  id: number;
  anchor: ChoreCelebrationAnchor | null;
  move: ChoreMoveId;
  sound: ChoreSoundId;
  /** The praise line as text (said aloud) ... */
  praise: string;
  /** ... and in the pieces that pop in, with the name marked where it was filled. */
  praiseWords: PraiseWord[];
  /** `performance.now()` when it started: every beat is timed from here. */
  startedAt: number;
  /** Reduced motion: nothing moves; the banner, its stars and the praise simply appear. */
  calm: boolean;
  phase: ChoreCelebrationPhase;
  /** When it ends, in ms from the start: the beats' end, or a surface's shorter cap. */
  endsAt: number;
}

export const choreCelebrationKey = (memberId: string, block: ChoreBlock) => `${memberId}:${block}`;

/**
 * Every celebration playing now, by `member:block`: two beans finishing together on the wall
 * each get their whole celebration. Shallow (the anchors hold DOM elements, never reactive),
 * and replaced, never mutated, so readers re-render.
 */
const activeChores = shallowRef<ReadonlyMap<string, ActiveChoreCelebration>>(new Map());
const choreTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

/**
 * Invisible HOLDS: a bean's block whose finishing tick is being written (predicted at the tap).
 * A held block keeps its rows mounted, so the celebration (which starts only once the store has
 * committed) bursts from the very tick that was tapped. Nothing else: no banner, no sound, no
 * telemetry. Each hold has its own safety release, so a write that never settles cannot hold a
 * block for ever.
 */
const holds = shallowRef<ReadonlyMap<string, ReturnType<typeof setTimeout>>>(new Map());
export const CHORE_HOLD_SAFETY_MS = 6000;

/**
 * Celebrations overlapping on the wall sound like ONE: a sound starts at most once in this
 * window, and a later celebration inside it (or while a sound is still waiting to start) plays
 * silently rather than stacking a second full sound on the first (which is never cut). Every
 * celebration sound is under about two seconds.
 */
export const CELEBRATION_SOUND_GAP_MS = 2000;
/** When a celebration sound last actually STARTED. */
let lastSoundAt = Number.NEGATIVE_INFINITY;
/** The celebration whose sound may still be waiting to start (the cheer loading). */
let soundOwner: string | null = null;
let lastPraise: number | null = null;
let lastSound: ChoreSoundId | null = null;
let storageNoted = false;
/** The last sound this device played, so a reload still never repeats it. */
const LAST_SOUND_KEY = 'beanies.choreCelebration.lastSound';

/** Storage can be blocked (a private window): noted once, then the in-memory value serves. */
function noteStorage(detail: 'read' | 'write', error: unknown): void {
  if (storageNoted) return;
  storageNoted = true;
  logEvent({
    level: 'debug',
    surface: CHORE_CELEBRATION_SURFACE,
    message: 'last-sound storage unavailable; remembered in memory only',
    context: { action: 'last-sound-storage', detail },
    error,
  });
}

function readLastSound(): ChoreSoundId | null {
  if (lastSound) return lastSound;
  try {
    const v = localStorage.getItem(LAST_SOUND_KEY);
    return isChoreSoundId(v) ? v : null;
  } catch (e) {
    noteStorage('read', e);
    return null;
  }
}

function rememberSound(id: ChoreSoundId): void {
  lastSound = id;
  try {
    localStorage.setItem(LAST_SOUND_KEY, id);
  } catch (e) {
    noteStorage('write', e);
  }
}

function prefersReducedMotionNow(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Hold this bean's block (see `holds`) while its predicted finishing tick is written. Released
 * by `releaseChoreBlock` on every exit, or by its own safety timer.
 */
export function holdChoreBlock(memberId: string, block: ChoreBlock): void {
  const key = choreCelebrationKey(memberId, block);
  const next = new Map(holds.value);
  const old = next.get(key);
  if (old) clearTimeout(old);
  next.set(
    key,
    setTimeout(() => releaseChoreBlock(memberId, block), CHORE_HOLD_SAFETY_MS)
  );
  holds.value = next;
}

export function releaseChoreBlock(memberId: string, block: ChoreBlock): void {
  const key = choreCelebrationKey(memberId, block);
  const timer = holds.value.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  const next = new Map(holds.value);
  next.delete(key);
  holds.value = next;
}

/** The banner is due: show it, unless the block was unticked during the burst (then end). */
function arriveBanner(key: string): void {
  const cur = activeChores.value.get(key);
  if (!cur || cur.phase === 'banner') return;
  if (cur.stillDone && !cur.stillDone()) {
    logEvent({
      level: 'info',
      surface: CHORE_CELEBRATION_SURFACE,
      message: 'chore celebration ended: the block was unticked during the burst',
      context: { action: 'ended-undone', kind: cur.move, slot: cur.block },
    });
    dismissChoreCelebration(key);
    return;
  }
  const next = new Map(activeChores.value);
  next.set(key, { ...cur, phase: 'banner' });
  activeChores.value = next;
}

/**
 * End one celebration (`key`), or every one (no key: a route change, a reset). A sound it owns
 * that is still waiting to start never starts now; a sound already playing finishes its tail.
 */
export function dismissChoreCelebration(key?: string): void {
  const keys = key === undefined ? [...activeChores.value.keys()] : [key];
  if (!keys.some((k) => activeChores.value.has(k))) return;
  const next = new Map(activeChores.value);
  for (const k of keys) {
    choreTimers.get(k)?.forEach(clearTimeout);
    choreTimers.delete(k);
    if (soundOwner === k) {
      cancelChoreCelebrationSound();
      soundOwner = null;
    }
    next.delete(k);
  }
  activeChores.value = next;
}

/** Outcomes where a sound really started (a fallback is still a sound). */
const STARTED = new Set(['played', 'fallback', 'late', 'fanfare-late', 'fanfare-failed']);

/**
 * The sound for a new celebration, unless another one's sound is still in its window or still
 * waiting to start. The window and the "last played" memory are stamped only once a sound has
 * actually started, so a skipped or cancelled sound blocks nothing and repeats nothing.
 */
function playSoundFor(key: string, sound: ChoreSoundId, move: ChoreMoveId): void {
  const paired = SOUND_FOR_MOVE[move];
  if (soundOwner !== null || performance.now() - lastSoundAt < CELEBRATION_SOUND_GAP_MS) {
    logEvent({
      level: 'debug',
      surface: CHORE_CELEBRATION_SURFACE,
      message: 'chore celebration sound did not start',
      context: { action: 'sound-skipped', stage: 'overlap', detail: sound, kind: move },
    });
    return;
  }
  soundOwner = key;
  playChoreCelebrationSound(sound, paired)
    .then((outcome) => {
      if (soundOwner === key) soundOwner = null;
      if (STARTED.has(outcome)) {
        lastSoundAt = performance.now();
        rememberSound(sound);
      }
      if (outcome === 'fallback' || outcome === 'late') {
        logEvent({
          level: 'warn',
          surface: CHORE_CELEBRATION_SURFACE,
          message: 'chore celebration played the paired sound in place of the cheer',
          context: { action: 'fallback-sound', detail: paired, kind: move, stage: outcome },
        });
      } else if (outcome === 'fanfare-late' || outcome === 'fanfare-failed') {
        const late = outcome === 'fanfare-late';
        logEvent({
          level: 'warn',
          surface: CHORE_CELEBRATION_SURFACE,
          message: late
            ? 'chore celebration sounds were still loading at the cutoff; the fanfare played'
            : 'chore celebration sounds could not load; the fanfare played',
          context: {
            action: 'fallback-fanfare',
            stage: late ? 'late' : 'failed',
            detail: sound,
            kind: move,
          },
        });
      } else if (outcome !== 'played') {
        // Nothing started: muted, superseded, dismissed while it waited, or no Web Audio.
        // Logged so the `play` rate can be read against it.
        logEvent({
          level: 'debug',
          surface: CHORE_CELEBRATION_SURFACE,
          message: 'chore celebration sound did not start',
          context: { action: 'sound-skipped', stage: outcome, detail: sound, kind: move },
        });
      }
    })
    .catch((error: unknown) => {
      if (soundOwner === key) soundOwner = null;
      reportError({
        surface: CHORE_CELEBRATION_SURFACE,
        message: 'a chore celebration sound failed to play; the celebration went on silently',
        severity: 'warning',
        error,
        context: { action: 'sound-failed', detail: sound, kind: move },
      });
    });
}

/**
 * Start the choreboard's all-done celebration (#146) for a bean's block. Called only by
 * `choreStore`, and only once the block's `celebrated` mark was created by that very write: once
 * per bean, block and day, on every device. Picks the move (the device's weekday), the sound and
 * the praise line, plays the sound, and times the phases FROM THIS START (the banner at +560 ms,
 * the end at +3060 ms). `settled` (a block already showing its banner: found done after another
 * device's tick, or a commit that took long) skips the burst from the tick. The timers live
 * HERE, not in the (lazy) component, so the banner still arrives and the celebration still ends
 * if the component never loads.
 *
 * Returns the celebration's key, or null when that bean's block is already celebrating.
 */
export function celebrateChore(req: ChoreCelebrationRequest): string | null {
  const key = choreCelebrationKey(req.memberId, req.block);
  if (activeChores.value.has(key)) return null;
  const t = useTranslationStore().t;
  const calm = prefersReducedMotionNow();
  const move = moveForDate(new Date());
  const sound = pickChoreSound(move, readLastSound());
  const praiseIndex = pickPraiseIndex(req.block, lastPraise);
  lastPraise = praiseIndex;
  const meta = CHORE_BLOCK_META[req.block];
  const praise = fillPraise(t(CHORE_PRAISE[praiseIndex]!.key), {
    name: req.beanName,
    block: t(meta.labelKey),
    blockWord: t(meta.wordKey),
  });
  // The wall caps every celebration's time on screen (`autoDismissMs`); this one is shorter
  // than its cap, so the cap only bites if a surface ever asks for less than three seconds.
  const natural = calm ? BEATS.calmDone : BEATS.done;
  const cap = mode.value.autoDismissMs;
  const endsAt = cap !== null ? Math.min(natural, cap) : natural;
  const anchor = req.anchor ? markRaw(req.anchor) : null;
  const next = new Map(activeChores.value);
  next.set(key, {
    ...req,
    key,
    anchor,
    id: nextId++,
    move,
    sound,
    praise: praise.text,
    praiseWords: praise.words,
    startedAt: performance.now(),
    calm,
    // Calm and settled have no burst: the banner from the start (still checked by `stillDone`
    // at the flip for the others).
    phase: calm || req.settled ? 'banner' : 'burst',
    endsAt,
  });
  activeChores.value = next;
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (!calm && !req.settled) timers.push(setTimeout(() => arriveBanner(key), BEATS.swap));
  timers.push(setTimeout(() => dismissChoreCelebration(key), endsAt));
  choreTimers.set(key, timers);

  logEvent({
    level: 'info',
    surface: CHORE_CELEBRATION_SURFACE,
    message: 'chore celebration played',
    context: {
      action: 'play',
      kind: move,
      detail: sound,
      count: req.count,
      slot: req.block,
      stage: anchor ? (req.settled ? 'settled' : 'anchored') : 'centered',
      format: calm ? 'calm' : 'full',
    },
  });
  if (!anchor) {
    logEvent({
      level: 'warn',
      surface: CHORE_CELEBRATION_SURFACE,
      message: 'chore celebration had no anchor; played centered',
      context: { action: 'fallback-centered', detail: 'no-anchor', kind: move, slot: req.block },
    });
  }
  playSoundFor(key, sound, move);
  return key;
}

/**
 * The tick surface's question: should this bean's block keep showing its (all ticked) rows a
 * moment longer? While its finishing tick is held (being written), and through an anchored
 * celebration's burst. A centered celebration holds nothing: it is not about the board on screen.
 */
export function choreBlockHeld(memberId: string, block: ChoreBlock): boolean {
  const key = choreCelebrationKey(memberId, block);
  if (holds.value.has(key)) return true;
  const c = activeChores.value.get(key);
  return !!c?.anchor && c.phase === 'burst';
}

const bannerMemo = new Map<number, BannerCelebration>();

/** The banner's celebrating form for this bean's block, or null when it is not celebrating. */
export function choreBannerCelebration(
  memberId: string,
  block: ChoreBlock
): BannerCelebration | null {
  const c = activeChores.value.get(choreCelebrationKey(memberId, block));
  if (!c?.anchor || c.phase !== 'banner') return null;
  let value = bannerMemo.get(c.id);
  if (!value) {
    if (bannerMemo.size > 16) bannerMemo.clear();
    value = { words: c.praiseWords, calm: c.calm };
    bannerMemo.set(c.id, value);
  }
  return value;
}

/** Tests only: forget the rotation memory, the sound window, holds and every celebration. */
export function resetChoreCelebrationForTest(): void {
  dismissChoreCelebration();
  for (const timer of holds.value.values()) clearTimeout(timer);
  holds.value = new Map();
  lastPraise = null;
  lastSound = null;
  storageNoted = false;
  bannerMemo.clear();
  lastSoundAt = Number.NEGATIVE_INFINITY;
  soundOwner = null;
}

export function useCelebration() {
  function dismissModal() {
    activeModal.value = null;
  }

  function dismissShower(id?: number) {
    // Guard on id so a stale timer cannot clear a NEWER celebration that
    // started while the previous one was still fading out.
    if (id !== undefined && activeShower.value?.id !== id) return;
    activeShower.value = null;
  }

  return {
    toasts,
    activeModal,
    activeShower,
    activeChores,
    mode,
    dismissModal,
    dismissShower,
    dismissChoreCelebration,
  };
}
