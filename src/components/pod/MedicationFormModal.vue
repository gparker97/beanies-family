<script setup lang="ts">
/**
 * Add/edit a Medication — dose, frequency, duration, optional notes,
 * and an optional bottle photo (max 1). First production consumer of
 * `<PhotoAttachments max="1">`.
 *
 * `startDate` defaults to today on the add path. `ongoing` toggles
 * clear `endDate` as a convenience so the two fields stay consistent.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import FrequencyChips, { type ChipOption } from '@/components/ui/FrequencyChips.vue';
import PhotoAttachments from '@/components/media/PhotoAttachments.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { confirm } from '@/composables/useConfirm';
import { toDateInputValue } from '@/utils/date';
import { frequencyDisplayFor, isValidDosesPerDay } from '@/utils/medicationFrequency';
import type { Medication, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  memberId: UUID;
  medication?: Medication | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const medicationsStore = useMedicationsStore();
const familyStore = useFamilyStore();

const name = ref('');
const dose = ref('');
const frequency = ref('');
const dosesPerDay = ref<number | null>(null);
const startDate = ref('');
const endDate = ref('');
const ongoing = ref(true);
const notes = ref('');
const photoIds = ref<UUID[]>([]);

// FrequencyChips uses string values; bridge via a computed-with-setter so
// the chip surface stays simple while the model carries `number | null`.
// Legacy records (dosesPerDay === undefined) display as 'other' with the
// existing `frequency` text preserved — no information loss on first edit.
const doseChoice = computed<string>({
  get() {
    return isValidDosesPerDay(dosesPerDay.value) ? String(dosesPerDay.value) : 'other';
  },
  set(v: string) {
    if (v === 'other') {
      dosesPerDay.value = null;
      // Leave `frequency` as-is so the user's existing/typed text survives.
      return;
    }
    const n = Number(v);
    if (!isValidDosesPerDay(n)) {
      console.warn('[MedicationFormModal] invalid dose choice:', v);
      return;
    }
    dosesPerDay.value = n;
    // Auto-fill the display string. Overwrites any prior free-text value
    // because picking a structured option is an explicit user intent to
    // use that option's display label.
    frequency.value = frequencyDisplayFor(n, t);
  },
});

const doseOptions = computed<ChipOption[]>(() => [
  { value: '1', label: t('medications.dosesOption.once') },
  { value: '2', label: t('medications.dosesOption.twice') },
  { value: '3', label: t('medications.dosesOption.three') },
  { value: '4', label: t('medications.dosesOption.four') },
  { value: 'other', label: t('medications.dosesOption.other') },
]);

// When `ongoing` flips on, clear any leftover endDate so the two
// fields don't contradict each other on save.
watch(ongoing, (val) => {
  if (val) endDate.value = '';
});

// Once we have an id (after create returns), PhotoAttachments needs it
// to scope uploads. For a brand-new medication we eagerly create the
// record on first photo attach — see `attachFirstPhoto` below.
const medicationId = ref<UUID | null>(null);

const { isEditing, isSubmitting } = useFormModal(
  () => props.medication,
  () => props.open,
  {
    onEdit: (m) => {
      name.value = m.name;
      dose.value = m.dose;
      frequency.value = m.frequency;
      // Defensive: if a stored dosesPerDay is non-null but invalid (corrupted
      // from another device, schema drift, etc.), warn so devs see it in the
      // console and the auto-Slack reporter picks it up rather than silently
      // demoting to 'other'.
      if (
        m.dosesPerDay !== null &&
        m.dosesPerDay !== undefined &&
        !isValidDosesPerDay(m.dosesPerDay)
      ) {
        console.warn(
          '[MedicationFormModal] medication loaded with invalid dosesPerDay:',
          m.dosesPerDay,
          '— falling back to "Other"'
        );
      }
      // Treat undefined (legacy) and invalid identically — both surface as
      // 'other' in the chip group with the existing free-text preserved.
      dosesPerDay.value = isValidDosesPerDay(m.dosesPerDay) ? m.dosesPerDay : null;
      startDate.value = m.startDate ?? '';
      endDate.value = m.endDate ?? '';
      ongoing.value = m.ongoing ?? false;
      notes.value = m.notes ?? '';
      photoIds.value = [...(m.photoIds ?? [])];
      medicationId.value = m.id;
    },
    onNew: () => {
      name.value = '';
      dose.value = '';
      frequency.value = '';
      dosesPerDay.value = null;
      startDate.value = toDateInputValue(new Date());
      endDate.value = '';
      ongoing.value = true;
      notes.value = '';
      photoIds.value = [];
      medicationId.value = null;
    },
  }
);

const canSave = computed(
  () =>
    name.value.trim().length > 0 &&
    dose.value.trim().length > 0 &&
    frequency.value.trim().length > 0
);

const title = computed(() =>
  isEditing.value ? t('medications.editTitle') : t('medications.addTitle')
);

function buildPayload() {
  return {
    memberId: props.memberId,
    name: name.value.trim(),
    dose: dose.value.trim(),
    frequency: frequency.value.trim(),
    // Persist null explicitly so 'other' is distinguishable from "not yet
    // structured" (legacy undefined). useCriticalItems treats both as
    // "no reminder" — but downstream logic may diverge, so be explicit.
    dosesPerDay: dosesPerDay.value,
    ...(startDate.value ? { startDate: startDate.value } : {}),
    ...(endDate.value ? { endDate: endDate.value } : {}),
    ...(ongoing.value ? { ongoing: true as const } : {}),
    ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
    ...(photoIds.value.length ? { photoIds: [...photoIds.value] } : {}),
  };
}

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const payload = buildPayload();
    if (isEditing.value && props.medication) {
      await medicationsStore.updateMedication(props.medication.id, payload);
    } else if (medicationId.value) {
      // Record was created mid-flow to attach a photo — update it with
      // the final form values.
      await medicationsStore.updateMedication(medicationId.value, payload);
    } else {
      await medicationsStore.createMedication(payload);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.medication) return;
  const ok = await confirm({
    title: 'medications.deleteConfirm.title',
    message: 'medications.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await medicationsStore.deleteMedication(props.medication.id);
  emit('close');
}

/**
 * PhotoAttachments needs a concrete entityId. For a new medication we
 * don't have one until save — so the first time the user tries to
 * attach a photo we eagerly create the record with whatever's in the
 * form so far. Subsequent saves update it. If the user cancels before
 * saving, the orphan record sticks around; the photo GC will sweep
 * its bottle photo after 24h but the medication itself stays unless
 * the user deletes it manually. (Acceptable tradeoff for v1 —
 * photo-on-new is rare; photo-on-edit is the common case.)
 */
const photoAttachmentsRef = ref<{ openPicker: () => void } | null>(null);

async function ensureMedicationId(): Promise<UUID | null> {
  if (medicationId.value) return medicationId.value;
  if (!canSave.value) return null;
  const created = await medicationsStore.createMedication(buildPayload());
  if (!created) return null;
  medicationId.value = created.id;
  return created.id;
}

async function handleAddFirstPhoto(): Promise<void> {
  const id = await ensureMedicationId();
  if (!id) return;
  await nextTick();
  photoAttachmentsRef.value?.openPicker();
}

function updatePhotoIds(ids: UUID[]): void {
  photoIds.value = ids;
  const id = medicationId.value ?? props.medication?.id;
  if (id) {
    // Persist the photoIds change immediately so the Automerge record
    // matches what usePhotos has wired up. Other form edits still
    // commit only on Save.
    void medicationsStore.updateMedication(id, { photoIds: ids });
  }
}

const currentMemberId = computed(() => familyStore.currentMember?.id);
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="title"
    icon="💊"
    icon-bg="var(--tint-silk-20)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('medications.field.name')" required>
      <BaseInput v-model="name" :placeholder="t('medications.placeholder.name')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('medications.field.dose')" required>
      <BaseInput v-model="dose" :placeholder="t('medications.placeholder.dose')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('medications.field.dosesPerDay')" required>
      <FrequencyChips v-model="doseChoice" :options="doseOptions" />
    </FormFieldGroup>

    <!-- Live preview — shows users exactly what gets saved as the display
         string. Hidden when 'Other' selected (they're typing it themselves). -->
    <p
      v-if="dosesPerDay !== null"
      class="font-outfit -mt-2 text-xs text-[var(--color-text-muted)] italic dark:text-gray-400"
    >
      {{ t('medications.willDisplayAs') }} "{{ frequency }}"
    </p>

    <!-- Free-text reveal — only when 'Other' chip is selected. -->
    <Transition name="other-reveal">
      <FormFieldGroup
        v-if="dosesPerDay === null"
        :label="t('medications.frequencyDescribe')"
        required
      >
        <BaseInput v-model="frequency" :placeholder="t('medications.placeholder.frequency')" />
      </FormFieldGroup>
    </Transition>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormFieldGroup :label="t('medications.field.startDate')" optional>
        <BeanieDatePicker v-model="startDate" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('medications.field.endDate')" optional>
        <BeanieDatePicker v-model="endDate" :disabled="ongoing" />
      </FormFieldGroup>
    </div>

    <div
      class="flex items-center justify-between rounded-[12px] bg-[var(--tint-slate-5)] px-3 py-2.5 dark:bg-slate-700"
    >
      <span class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-200">
        {{ t('medications.field.ongoing') }}
      </span>
      <ToggleSwitch v-model="ongoing" size="sm" />
    </div>

    <FormFieldGroup :label="t('medications.field.notes')" optional>
      <BaseInput v-model="notes" :placeholder="t('medications.placeholder.notes')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('medications.field.photo')" optional>
      <div v-if="medicationId || medication" class="photo-wrapper">
        <PhotoAttachments
          ref="photoAttachmentsRef"
          collection="medications"
          :entity-id="(medicationId ?? medication?.id) as UUID"
          :photo-ids="photoIds"
          :current-member-id="currentMemberId"
          :max="1"
          @update:photo-ids="updatePhotoIds"
        />
      </div>
      <button
        v-else
        type="button"
        class="hover:border-primary-500 hover:text-primary-500 flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canSave"
        @click="handleAddFirstPhoto"
      >
        <BeanieIcon name="camera" size="md" />
        <span class="font-outfit text-xs font-semibold">
          {{ canSave ? t('photos.addPhoto') : t('medications.photos.saveFirst') }}
        </span>
      </button>
    </FormFieldGroup>
  </BeanieFormModal>
</template>

<style scoped>
.photo-wrapper :deep(.photos-root) {
  margin-top: 0;
}

/* "Other" free-text reveal — slides + fades in to feel like the input
 * unfolded from the chip choice rather than appearing abruptly. */
.other-reveal-enter-active {
  overflow: hidden;
  transition:
    max-height 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.18s 0.04s ease-out,
    margin-top 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.other-reveal-leave-active {
  overflow: hidden;
  transition:
    max-height 0.15s ease-in,
    opacity 0.1s ease-in,
    margin-top 0.15s ease-in;
}

.other-reveal-enter-from,
.other-reveal-leave-to {
  margin-top: 0;
  max-height: 0;
  opacity: 0;
}

.other-reveal-enter-to,
.other-reveal-leave-from {
  max-height: 6rem;
  opacity: 1;
}
</style>
