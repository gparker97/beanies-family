<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useCurrencyOptions } from '@/composables/useCurrencyOptions';
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
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateGoalInput | { id: string; data: UpdateGoalInput }];
  delete: [id: string];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const { currencyOptions } = useCurrencyOptions();

// Goal type icon chip options
const GOAL_ICON_OPTIONS = [
  { value: '🎯', label: 'Debt Payoff', icon: '🎯' },
  { value: '📈', label: 'Investment', icon: '📈' },
  { value: '🛍️', label: 'Purchase', icon: '🛍️' },
  { value: '🐷', label: 'Savings', icon: '🐷' },
  { value: '📦', label: 'Other', icon: '📦' },
];

const emojiToType: Record<string, GoalType> = {
  '🐷': 'savings',
  '🎯': 'debt_payoff',
  '📈': 'investment',
  '🛍️': 'purchase',
  '📦': 'savings', // "Other" defaults to savings
};

const typeToEmoji: Record<GoalType, string> = {
  savings: '🐷',
  debt_payoff: '🎯',
  investment: '📈',
  purchase: '🛍️',
};

// Priority options
const priorityOptions = [
  { value: 'low', label: t('goals.priority.low') },
  { value: 'medium', label: t('goals.priority.medium') },
  { value: 'high', label: t('goals.priority.high') },
  { value: 'critical', label: t('goals.priority.critical') },
];

// Form state
const goalEmoji = ref('');
const name = ref('');
const type = ref<GoalType>('savings');
const targetAmount = ref<number | undefined>(undefined);
const currentAmount = ref<number | undefined>(0);
const currency = ref('');
const priority = ref<GoalPriority>('medium');
const memberId = ref('');
const deadline = ref('');

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
      priority.value = 'medium';
      memberId.value = '';
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
      memberId: memberId.value || undefined,
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
    <div>
      <input
        v-model="name"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-lg font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('modal.goalName')"
      />
    </div>

    <!-- 3. Amounts side by side -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <AmountInput
        v-model="targetAmount"
        :currency-symbol="currency || settingsStore.displayCurrency"
        font-size="1.2rem"
        :label="t('modal.targetAmount')"
      />
      <AmountInput
        v-model="currentAmount"
        :currency-symbol="currency || settingsStore.displayCurrency"
        font-size="1.2rem"
        :label="t('modal.currentAmount')"
      />
    </div>

    <!-- 4. Currency -->
    <FormFieldGroup :label="t('form.currency')">
      <BaseSelect v-model="currency" :options="currencyOptions" />
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
      <BaseInput v-model="deadline" type="date" />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
