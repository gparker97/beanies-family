<script setup lang="ts">
/**
 * Quick-contribute modal. Opens from the GoalViewModal footer's primary
 * "Contribute" button; stacks as a centered modal over the drawer.
 *
 * Two inputs: amount (required, > 0) + optional note. Saving calls
 * `useContributeToGoal.contribute(...)` which appends the contribution,
 * fires the success-with-undo toast, and checks milestone celebration.
 *
 * This modal is intentionally minimal — no progress-bar preview, no
 * advanced fields — because the "contribute toward a goal" action should
 * feel like a one-tap experience.
 */
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useContributeToGoal } from '@/composables/useContributeToGoal';
import { useTranslation } from '@/composables/useTranslation';
import type { Goal } from '@/types/models';

const props = defineProps<{
  open: boolean;
  goal: Goal | null;
}>();

const emit = defineEmits<{
  close: [];
  'contribution-added': [contributionId: string];
}>();

const { t } = useTranslation();
const { contribute } = useContributeToGoal();

const amount = ref<number | undefined>(undefined);
const note = ref<string>('');
const isSubmitting = ref(false);

// Reset form state when modal opens (so a second contribution starts fresh).
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      amount.value = undefined;
      note.value = '';
      isSubmitting.value = false;
    }
  }
);

const canSave = computed(
  () => !!amount.value && amount.value > 0 && !isSubmitting.value && !!props.goal
);

async function onSubmit() {
  if (!canSave.value || !props.goal || amount.value === undefined) return;
  isSubmitting.value = true;
  try {
    const result = await contribute(props.goal.id, {
      amount: amount.value,
      note: note.value.trim() || undefined,
    });
    if (result.success && result.contributionId) {
      emit('contribution-added', result.contributionId);
      emit('close');
    }
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open && !!goal"
    variant="modal"
    size="narrow"
    :title="t('goalContribute.title')"
    icon="💰"
    :save-label="t('goalContribute.button')"
    save-gradient="orange"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onSubmit"
  >
    <template v-if="goal">
      <div class="space-y-4">
        <!-- Context: which goal we're contributing to -->
        <p class="font-outfit text-sm text-[#2C3E50]/70 dark:text-gray-300">
          {{ goal.name }}
        </p>

        <FormFieldGroup :label="t('goalContribute.amountLabel')">
          <AmountInput v-model="amount" :placeholder="t('goalContribute.amountPlaceholder')" />
        </FormFieldGroup>

        <FormFieldGroup :label="t('goalContribute.noteLabel')">
          <BaseInput
            v-model="note"
            :placeholder="t('goalContribute.notePlaceholder')"
            maxlength="120"
          />
        </FormFieldGroup>
      </div>
    </template>
  </BeanieFormModal>
</template>
