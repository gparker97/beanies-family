<script setup lang="ts">
/**
 * Add/edit an Allergy record for a bean. Capture the full safety
 * picture: severity, type, what to avoid, reaction, emergency response,
 * who diagnosed it, and when it was last reviewed.
 *
 * Severity is a required one-tap chip (defaults to 'mild' per the
 * plan's form-defaults table — forces the user to confirm anything
 * higher). Same rationale for `reviewedOn` defaulting to today on
 * the add path.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { confirm } from '@/composables/useConfirm';
import { toDateInputValue } from '@/utils/date';
import type { Allergy, AllergySeverity, AllergyType, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  memberId: UUID;
  allergy?: Allergy | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const allergiesStore = useAllergiesStore();

const name = ref('');
const allergyType = ref<AllergyType>('food');
const severity = ref<AllergySeverity>('mild');
const avoidList = ref('');
const reaction = ref('');
const emergencyResponse = ref('');
const diagnosedBy = ref('');
const reviewedOn = ref('');

const typeOptions = computed(() => [
  { value: 'food', label: t('allergies.type.food'), icon: '\u{1F35C}' },
  { value: 'medication', label: t('allergies.type.medication'), icon: '\u{1F48A}' },
  { value: 'environmental', label: t('allergies.type.environmental'), icon: '\u{1F33E}' },
  { value: 'contact', label: t('allergies.type.contact'), icon: '\u270B' },
  { value: 'insect', label: t('allergies.type.insect'), icon: '\u{1F41D}' },
]);

const severityOptions = computed(() => [
  { value: 'severe', label: t('allergies.severity.severe'), icon: '\u{1F6A8}' },
  { value: 'moderate', label: t('allergies.severity.moderate'), icon: '\u26A0\uFE0F' },
  { value: 'mild', label: t('allergies.severity.mild'), icon: '\u{1F331}' },
]);

const { isEditing, isSubmitting } = useFormModal(
  () => props.allergy,
  () => props.open,
  {
    onEdit: (a) => {
      name.value = a.name;
      allergyType.value = a.allergyType;
      severity.value = a.severity;
      avoidList.value = a.avoidList ?? '';
      reaction.value = a.reaction ?? '';
      emergencyResponse.value = a.emergencyResponse ?? '';
      diagnosedBy.value = a.diagnosedBy ?? '';
      reviewedOn.value = a.reviewedOn ?? '';
    },
    onNew: () => {
      name.value = '';
      allergyType.value = 'food';
      severity.value = 'mild';
      avoidList.value = '';
      reaction.value = '';
      emergencyResponse.value = '';
      diagnosedBy.value = '';
      reviewedOn.value = toDateInputValue(new Date());
    },
  }
);

const canSave = computed(() => name.value.trim().length > 0);

const title = computed(() =>
  isEditing.value ? t('allergies.editTitle') : t('allergies.addTitle')
);

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const payload = {
      memberId: props.memberId,
      name: name.value.trim(),
      allergyType: allergyType.value,
      severity: severity.value,
      ...(avoidList.value.trim() ? { avoidList: avoidList.value.trim() } : {}),
      ...(reaction.value.trim() ? { reaction: reaction.value.trim() } : {}),
      ...(emergencyResponse.value.trim()
        ? { emergencyResponse: emergencyResponse.value.trim() }
        : {}),
      ...(diagnosedBy.value.trim() ? { diagnosedBy: diagnosedBy.value.trim() } : {}),
      ...(reviewedOn.value ? { reviewedOn: reviewedOn.value } : {}),
    };
    if (isEditing.value && props.allergy) {
      await allergiesStore.updateAllergy(props.allergy.id, payload);
    } else {
      await allergiesStore.createAllergy(payload);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.allergy) return;
  const ok = await confirm({
    title: 'allergies.deleteConfirm.title',
    message: 'allergies.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await allergiesStore.deleteAllergy(props.allergy.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="title"
    icon="⚠️"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('allergies.field.name')" required>
      <BaseInput v-model="name" :placeholder="t('allergies.placeholder.name')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('allergies.field.type')">
      <FrequencyChips
        :model-value="allergyType"
        :options="typeOptions"
        @update:model-value="(v: string) => (allergyType = v as AllergyType)"
      />
    </FormFieldGroup>

    <FormFieldGroup :label="t('allergies.field.severity')" required>
      <FrequencyChips
        :model-value="severity"
        :options="severityOptions"
        @update:model-value="(v: string) => (severity = v as AllergySeverity)"
      />
    </FormFieldGroup>

    <FormFieldGroup :label="t('allergies.field.avoidList')" optional>
      <BaseInput v-model="avoidList" :placeholder="t('allergies.placeholder.avoidList')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('allergies.field.reaction')" optional>
      <BaseInput v-model="reaction" :placeholder="t('allergies.placeholder.reaction')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('allergies.field.emergencyResponse')" optional>
      <BaseInput
        v-model="emergencyResponse"
        :placeholder="t('allergies.placeholder.emergencyResponse')"
      />
    </FormFieldGroup>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormFieldGroup :label="t('allergies.field.diagnosedBy')" optional>
        <BaseInput v-model="diagnosedBy" :placeholder="t('allergies.placeholder.diagnosedBy')" />
      </FormFieldGroup>

      <FormFieldGroup :label="t('allergies.field.reviewedOn')" optional>
        <BaseInput v-model="reviewedOn" type="date" />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
