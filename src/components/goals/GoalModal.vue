<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import type {
  Goal,
  GoalType,
  GoalPriority,
  CreateGoalInput,
  UpdateGoalInput,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  goal?: Goal | null;
  defaults?: { memberId?: string; priority?: GoalPriority };
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateGoalInput | { id: string; data: UpdateGoalInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();

// Goal type icon chip options
const GOAL_ICON_OPTIONS = [
  { value: '🐷', label: 'Savings', icon: '🐷' },
  { value: '🎯', label: 'Debt Payoff', icon: '🎯' },
  { value: '📈', label: 'Investment', icon: '📈' },
  { value: '✈️', label: 'Vacation', icon: '✈️' },
  { value: '🚗', label: 'Vehicle', icon: '🚗' },
  { value: '🏠', label: 'Home', icon: '🏠' },
  { value: '🎓', label: 'Education', icon: '🎓' },
  { value: '🛟', label: 'Emergency Fund', icon: '🛟' },
  { value: '🛍️', label: 'Other Purchase', icon: '🛍️' },
];

const emojiToType: Record<string, GoalType> = {
  '🐷': 'savings',
  '🎯': 'debt_payoff',
  '📈': 'investment',
  '✈️': 'vacation',
  '🚗': 'vehicle',
  '🏠': 'home',
  '🎓': 'education',
  '🛟': 'emergency',
  '🛍️': 'purchase',
};

const typeToEmoji: Record<GoalType, string> = {
  savings: '🐷',
  debt_payoff: '🎯',
  investment: '📈',
  vacation: '✈️',
  vehicle: '🚗',
  home: '🏠',
  education: '🎓',
  emergency: '🛟',
  purchase: '🛍️',
};

// Priority options
const priorityOptions = [
  { value: 'low', label: t('goals.priority.low') },
  { value: 'medium', label: t('goals.priority.medium') },
  { value: 'high', label: t('goals.priority.high') },
  { value: 'critical', label: t('goals.priority.critical') },
];

// Form state — note: the user-facing field is "Remaining amount" (how
// much is left to reach the target). Internally we still work with
// `currentAmount` for storage + delta math, but the UI binds to a
// `remainingAmount` computed so the user sees their goal in intuitive
// "how much to go" terms. Reducing the remaining amount (e.g., after
// contributing) becomes a positive delta on `currentAmount`, which the
// store invariant records as a positive manual contribution.
const goalEmoji = ref('');
const name = ref('');
const type = ref<GoalType>('savings');
const targetAmount = ref<number | undefined>(undefined);
const currentAmount = ref<number | undefined>(0);
const currency = ref('');
const priority = ref<GoalPriority>('medium');
const memberId = ref('');
const deadline = ref('');

/**
 * Two-way bridge between the user-facing "Remaining amount" field and the
 * stored `currentAmount`. Clamps remaining to [0, targetAmount] on write
 * so the user can't enter a negative remaining (which would imply
 * overshot progress via this field; overshooting is reserved for the
 * Contribute flow where crossing the target auto-completes the goal).
 */
const remainingAmount = computed<number | undefined>({
  get: () => {
    const target = targetAmount.value ?? 0;
    const current = currentAmount.value ?? 0;
    return Math.max(0, target - current);
  },
  set: (value) => {
    const target = targetAmount.value ?? 0;
    const remaining = Math.max(0, Math.min(target, value ?? 0));
    currentAmount.value = target - remaining;
  },
});

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.goal,
  () => props.open,
  {
    onEdit: (goal) => {
      goalEmoji.value = typeToEmoji[goal.type] || '🐷';
      name.value = goal.name;
      type.value = goal.type;
      targetAmount.value = goal.targetAmount;
      currentAmount.value = goal.currentAmount;
      currency.value = goal.currency;
      priority.value = goal.priority;
      memberId.value = goal.memberId ?? '';
      deadline.value = goal.deadline ?? '';
    },
    onNew: () => {
      goalEmoji.value = '';
      name.value = '';
      type.value = 'savings';
      targetAmount.value = undefined;
      currentAmount.value = 0;
      currency.value = settingsStore.displayCurrency;
      priority.value = props.defaults?.priority ?? 'medium';
      memberId.value = props.defaults?.memberId ?? '';
      deadline.value = '';
    },
  }
);

// Derive type from emoji
watch(goalEmoji, (emoji) => {
  if (emoji && emojiToType[emoji]) {
    type.value = emojiToType[emoji]!;
  }
});

const canSave = computed(() => name.value.trim().length > 0 && (targetAmount.value ?? 0) > 0);

const modalTitle = computed(() => (isEditing.value ? t('goals.editGoal') : t('goals.addGoal')));

const saveLabel = computed(() => (isEditing.value ? t('modal.saveGoal') : t('modal.addGoal')));

function handleSave() {
  if (!canSave.value) return;
  isSubmitting.value = true;

  try {
    const data = {
      name: name.value.trim(),
      type: type.value,
      targetAmount: targetAmount.value ?? 0,
      currentAmount: currentAmount.value ?? 0,
      currency: currency.value,
      priority: priority.value,
      memberId: memberId.value && memberId.value !== '__shared__' ? memberId.value : null,
      deadline: deadline.value || undefined,
      isCompleted: false,
    };

    if (isEditing.value && props.goal) {
      emit('save', { id: props.goal.id, data: data as UpdateGoalInput });
    } else {
      emit('save', data as CreateGoalInput);
    }
  } finally {
    isSubmitting.value = false;
  }
}

function handleDelete() {
  if (props.goal) {
    emit('delete', props.goal.id);
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    size="narrow"
    :open="open"
    :title="modalTitle"
    :icon="goalEmoji || '🎯'"
    icon-bg="var(--tint-green-10)"
    :save-label="saveLabel"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <!-- 1. Goal type picker -->
    <FormFieldGroup :label="t('modal.selectCategory')">
      <FrequencyChips v-model="goalEmoji" :options="GOAL_ICON_OPTIONS" />
    </FormFieldGroup>

    <!-- 2. Goal name -->
    <FormFieldGroup :label="t('modal.goalName')" required>
      <input
        v-model="name"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-lg font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('modal.goalName')"
      />
    </FormFieldGroup>

    <!-- 3. Target amount + Currency (inline row) -->
    <FormFieldGroup :label="t('modal.targetAmount')" required>
      <CurrencyAmountInput v-model:amount="targetAmount" v-model:currency="currency" />
    </FormFieldGroup>

    <!-- 4. Remaining amount (= targetAmount - currentAmount, clamped to [0, targetAmount]) -->
    <FormFieldGroup :label="t('modal.remainingAmount')">
      <AmountInput
        v-model="remainingAmount"
        :currency-symbol="currency || settingsStore.displayCurrency"
        font-size="1.2rem"
      />
    </FormFieldGroup>

    <!-- 5. Priority chips -->
    <FormFieldGroup :label="t('modal.priority')">
      <FrequencyChips v-model="priority" :options="priorityOptions" />
    </FormFieldGroup>

    <!-- 6. Assign to member or Family -->
    <FormFieldGroup :label="t('modal.owner')">
      <FamilyChipPicker v-model="memberId" mode="single" show-shared />
    </FormFieldGroup>

    <!-- 7. Deadline -->
    <FormFieldGroup :label="t('modal.deadline')" optional>
      <BeanieDatePicker v-model="deadline" />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
