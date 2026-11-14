import { markRaw, ref, shallowRef } from 'vue';
import { playChime, playChoreCelebrationSound, playFanfare } from '@/composables/useSounds';
import { useTranslationStore } from '@/stores/translationStore';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { reportError } from '@/utils/errorReporter';
import {
  CHORE_CELEBRATION_BEATS as BEATS,
  CHORE_PRAISE,
  SOUND_FOR_MOVE,
  isChoreSoundId,
  moveForDate,
  pickChoreSound,
  pickPraiseIndex,
  type BannerCelebration,
  type ChoreCelebrationAnchor,
  type ChoreMoveId,
  type ChoreSoundId,
} from '@/utils/choreCelebration';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreBlock } from '@/types/models';

/**
 * `shower` is a full-viewport, `pointer-events: none`, self-dismissing
 * celebration. Unlike `modal` it can never sit unattended waiting for a
 * dismissal that never comes, and it never blocks a tap — which is what makes
 * it the right shape for a shared screen (the beanie wall) as well as a phone.
 *
 * `chore` is the choreboard's own (#146): no box, it plays over the board
 * anchored to the block that was just finished (`ChoreCelebration.vue`), and is
 * just as self-dismissing and tap-transparent as a shower.
 */
type CelebrationType = 'toast' | 'modal' | 'shower' | 'chore';

/** Not routine: these still play on a surface that suppresses the routine ones. */
const NOT_ROUTINE: ReadonlySet<CelebrationType> = new Set(['shower', 'chore']);

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
  | 'check-in-done'
  | 'chore-block-complete';

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
  // The choreboard (#146): a bean's last chore in a block was ticked. ONCE per bean, per block,
  // per day, on every device: `choreStore.toggleChore` fires it only in the same write as the
  // block's `celebrated` mark. No `onUndo`: a tick is undone by tapping it again, and the
  // once-only mark stays, so a re-tick shows the banner only. Its own move and sound, not the
  // shower (`celebrateChore` below); the message is the shower's, kept for the type.
  'chore-block-complete': {
    type: 'chore',
    messageKey: 'celebration.choreBlockComplete',
    asset: '/brand/beanies_celebrating_line_transparent_560x225.png',
  },
};

type ShowerTrigger = Exclude<CelebrationTrigger, 'chore-block-complete'>;

export function celebrate(
  trigger: 'chore-block-complete',
  options: { chore: ChoreCelebrationRequest }
): void;
export function celebrate(trigger: ShowerTrigger, options?: { onUndo?: () => void }): void;
export function celebrate(
  trigger: CelebrationTrigger,
  options?: { onUndo?: () => void; chore?: ChoreCelebrationRequest }
): void {
  const config = configs[trigger];
  if (!config) return;

  /**
   * A surface that gives its own per-action feedback opts out of the routine
   * ones. The beanie wall pops beans out of the tick itself, so the app-level
   * `goal-reached` MODAL on every chore tick was pure harm: a full-viewport
   * black scrim over a shared always-on screen, swallowing the next child's
   * tap. Showers still fire — finishing a whole list is not routine.
   */
  if (mode.value.suppressRoutine && !NOT_ROUTINE.has(config.type)) return;

  if (config.type === 'chore') {
    if (options?.chore) celebrateChore(options.chore);
    return;
  }

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
}

/**
 * `burst`: the tick pops and the stars fly out; the block still shows its rows.
 * `banner`: the banner has arrived (in its celebrating form) and the beanies do their move.
 */
export type ChoreCelebrationPhase = 'burst' | 'banner';

export interface ActiveChoreCelebration extends ChoreCelebrationRequest {
  id: number;
  anchor: ChoreCelebrationAnchor | null;
  move: ChoreMoveId;
  sound: ChoreSoundId;
  praise: string;
  /** `performance.now()` at the tick: every beat is timed from here. */
  startedAt: number;
  /** Reduced motion: nothing moves; the banner, its stars and the praise simply appear. */
  calm: boolean;
  phase: ChoreCelebrationPhase;
  /** When it ends, in ms from the start: the beats' end, or a surface's shorter cap. */
  endsAt: number;
}

/** Shallow: the anchor holds DOM elements, which must never be made reactive. */
const activeChore = shallowRef<ActiveChoreCelebration | null>(null);
let choreTimers: ReturnType<typeof setTimeout>[] = [];
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

function clearChoreTimers(): void {
  choreTimers.forEach(clearTimeout);
  choreTimers = [];
}

function setChorePhase(id: number, phase: ChoreCelebrationPhase): void {
  const cur = activeChore.value;
  if (cur?.id === id) activeChore.value = { ...cur, phase };
}

/** End the chore celebration (`id` guards a stale timer against a newer one). */
export function dismissChoreCelebration(id?: number): void {
  if (id !== undefined && activeChore.value?.id !== id) return;
  clearChoreTimers();
  activeChore.value = null;
}

/**
 * Pick, play and time one chore celebration. The phase timers live HERE, not in the (lazy)
 * component, so the banner still arrives and the celebration still ends if the component is
 * slow to load or never does.
 */
function celebrateChore(req: ChoreCelebrationRequest): void {
  clearChoreTimers();
  const t = useTranslationStore().t;
  const calm = prefersReducedMotionNow();
  const move = moveForDate(new Date());
  const paired = SOUND_FOR_MOVE[move];
  const sound = pickChoreSound(move, readLastSound());
  rememberSound(sound);
  const praiseIndex = pickPraiseIndex(req.block, lastPraise);
  lastPraise = praiseIndex;
  const meta = CHORE_BLOCK_META[req.block];
  const praise = fillTemplate(t(CHORE_PRAISE[praiseIndex]!.key), {
    name: req.beanName,
    block: t(meta.labelKey),
    blockWord: t(meta.wordKey),
  });
  // The wall caps every celebration's time on screen (`autoDismissMs`); this one is shorter
  // than its cap, so the cap only bites if a surface ever asks for less than three seconds.
  const natural = calm ? BEATS.calmDone : BEATS.done;
  const cap = mode.value.autoDismissMs;
  const endsAt = cap !== null ? Math.min(natural, cap) : natural;
  const id = nextId++;
  const anchor = req.anchor ? markRaw(req.anchor) : null;
  activeChore.value = {
    ...req,
    anchor,
    id,
    move,
    sound,
    praise,
    startedAt: performance.now(),
    calm,
    phase: calm ? 'banner' : 'burst',
    endsAt,
  };
  if (!calm) choreTimers.push(setTimeout(() => setChorePhase(id, 'banner'), BEATS.swap));
  choreTimers.push(setTimeout(() => dismissChoreCelebration(id), endsAt));

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
      stage: anchor ? 'anchored' : 'centered',
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

  playChoreCelebrationSound(sound, paired)
    .then((outcome) => {
      if (outcome !== 'fallback') return;
      logEvent({
        level: 'warn',
        surface: CHORE_CELEBRATION_SURFACE,
        message: 'chore celebration played the paired sound in place of the cheer',
        context: { action: 'fallback-sound', detail: paired, kind: move },
      });
    })
    .catch((error: unknown) => {
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
 * The tick surface's question while a celebration runs: is this bean's block in its burst,
 * so it should keep showing its (all ticked) rows a moment longer? Only an anchored celebration
 * holds a block: a centered one is not about the board on screen.
 */
export function choreBlockHeld(memberId: string, block: ChoreBlock): boolean {
  const c = activeChore.value;
  return !!c?.anchor && c.phase === 'burst' && c.memberId === memberId && c.block === block;
}

let bannerMemo: { id: number; value: BannerCelebration } | null = null;

/** The banner's celebrating form for this bean's block, or null when it is not the one. */
export function choreBannerCelebration(
  memberId: string,
  block: ChoreBlock
): BannerCelebration | null {
  const c = activeChore.value;
  if (!c?.anchor || c.phase !== 'banner' || c.memberId !== memberId || c.block !== block) {
    return null;
  }
  if (bannerMemo?.id !== c.id) {
    bannerMemo = { id: c.id, value: { praise: c.praise, name: c.beanName, calm: c.calm } };
  }
  return bannerMemo.value;
}

/** Tests only: forget the rotation memory and any celebration in flight. */
export function resetChoreCelebrationForTest(): void {
  dismissChoreCelebration();
  lastPraise = null;
  lastSound = null;
  storageNoted = false;
  bannerMemo = null;
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
    activeChore,
    mode,
    dismissModal,
    dismissShower,
    dismissChoreCelebration,
  };
}
