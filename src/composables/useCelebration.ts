import { ref } from 'vue';

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
  { type: CelebrationType; message: string; asset: string }
> = {
  'setup-complete': {
    type: 'modal',
    message: 'Setup complete — ready to start counting your beanies!',
    asset: '/brand/beanies-celebrating-line.png',
  },
  'first-account': {
    type: 'toast',
    message: 'Your first bean is planted!',
    asset: '/brand/beanies-celebrating-circle.png',
  },
  'first-transaction': {
    type: 'toast',
    message: 'Every beanie counts!',
    asset: '/brand/beanies-celebrating-circle.png',
  },
  'goal-reached': {
    type: 'modal',
    message: 'Goal complete! The beanies are proud!',
    asset: '/brand/beanies-celebrating-line.png',
  },
  'first-save': {
    type: 'toast',
    message: 'Your beanies are safe and encrypted!',
    asset: '/brand/beanies-celebrating-circle.png',
  },
  'debt-free': {
    type: 'modal',
    message: 'Debt-free! The beanies are celebrating!',
    asset: '/brand/beanies-celebrating-line.png',
  },
};

export function celebrate(trigger: CelebrationTrigger): void {
  const config = configs[trigger];
  if (!config) return;

  const celebration: Celebration = { id: nextId++, ...config };

  if (config.type === 'toast') {
    toasts.value.push(celebration);
    setTimeout(() => {
      toasts.value = toasts.value.filter((c) => c.id !== celebration.id);
    }, 4000);
  } else {
    activeModal.value = celebration;
  }
}

export function useCelebration() {
  function dismissModal() {
    activeModal.value = null;
  }

  return { toasts, activeModal, dismissModal };
}
