import { ref } from 'vue';
import { playChime, playFanfare } from '@/composables/useSounds';
import { useTranslationStore } from '@/stores/translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

type CelebrationType = 'toast' | 'modal';

export type CelebrationTrigger =
  | 'setup-complete'
  | 'first-account'
  | 'first-transaction'
  | 'goal-reached'
  | 'first-save'
  | 'debt-free';

interface Celebration {
  id: number;
  type: CelebrationType;
  message: string;
  asset: string;
}

let nextId = 0;

// Module-level state — shared across all callers so stores can trigger celebrations
const toasts = ref<Celebration[]>([]);
const activeModal = ref<Celebration | null>(null);

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
};

export function celebrate(trigger: CelebrationTrigger): void {
  const config = configs[trigger];
  if (!config) return;

  // Resolve translation at call time (store is initialized by this point)
  const translationStore = useTranslationStore();
  const message = translationStore.t(config.messageKey);

  const celebration: Celebration = {
    id: nextId++,
    type: config.type,
    message,
    asset: config.asset,
  };

  if (config.type === 'toast') {
    toasts.value.push(celebration);
    playChime();
    setTimeout(() => {
      toasts.value = toasts.value.filter((c) => c.id !== celebration.id);
    }, 4000);
  } else {
    activeModal.value = celebration;
    playFanfare();
  }
}

export function useCelebration() {
  function dismissModal() {
    activeModal.value = null;
  }

  return { toasts, activeModal, dismissModal };
}
