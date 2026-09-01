import { ref } from 'vue';
import { playChime, playFanfare } from '@/composables/useSounds';
import { useTranslationStore } from '@/stores/translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * `shower` is a full-viewport, `pointer-events: none`, self-dismissing
 * celebration. Unlike `modal` it can never sit unattended waiting for a
 * dismissal that never comes, and it never blocks a tap — which is what makes
 * it the right shape for a shared screen (the beanie wall) as well as a phone.
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
  | 'list-complete';

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

  return { toasts, activeModal, activeShower, mode, dismissModal, dismissShower };
}
