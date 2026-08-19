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
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import FrequencyChips, { type ChipOption } from '@/components/ui/FrequencyChips.vue';
import PhotoAttachments from '@/components/media/PhotoAttachments.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { confirm } from '@/composables/useConfirm';
import { useEagerEntityCreate } from '@/composables/useEagerEntityCreate';
import { usePhotoEntityBinding } from '@/composables/usePhotoEntityBinding';
import { usePhotoStore } from '@/stores/photoStore';
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
const photoStore = usePhotoStore();
const familyStore = useFamilyStore();

const name = ref('');
const dose = ref('');
const frequency = ref('');
const dosesPerDay = ref<number | null>(null);
const startDate = ref('');
const endDate = ref('');
const ongoing = ref(true);
const notes = ref('');

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

// The medication schedule is a single explicit choice, surfaced as a
// two-option segmented control instead of a bare "ongoing" toggle:
//   'ongoing' — no end date (stays on the active list until removed)
//   'ends'    — has an end date (reveals a required end-date picker)
// It's a presentation view over the existing `ongoing` boolean, so the
// data model and `buildPayload` are unchanged. Placing the choice ABOVE
// the end-date field (and revealing that field only when relevant) fixes
// the old "disabled end date with the reason hidden below it" confusion.
const schedule = computed<string>({
  get: () => (ongoing.value ? 'ongoing' : 'ends'),
  set: (v) => {
    ongoing.value = v === 'ongoing';
  },
});

const scheduleOptions = computed(() => [
  { value: 'ongoing', label: t('medications.schedule.ongoing') },
  { value: 'ends', label: t('medications.schedule.hasEndDate') },
]);

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
    },
  }
);

const canSave = computed(
  () =>
    name.value.trim().length > 0 &&
    dose.value.trim().length > 0 &&
    frequency.value.trim().length > 0 &&
    // Safety: a medication with an end date must actually carry one.
    // If the user chose "has an end date", block save until it's set —
    // an end-dated med with no date is a contradiction that shouldn't
    // persist onto a care-and-safety record.
    (ongoing.value || endDate.value.length > 0)
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
    ...(binding.photoIds.value.length ? { photoIds: [...binding.photoIds.value] } : {}),
  };
}

/**
 * Eager-create + photo-binding wiring.
 *
 * Eager-create gates on the same name / dose / frequency triple as
 * `canSave` — the user can attach a photo as soon as the medication
 * record is well-formed enough to save, but not before (the placeholder
 * label flips between "Add photo" and the "save first" hint based on
 * the same predicate).
 */
const photoAttachmentsRef = ref<{ openPicker: () => void } | null>(null);

const eager = useEagerEntityCreate<Medication, ReturnType<typeof buildPayload>>({
  resolveExistingId: () => props.medication?.id ?? null,
  firstMissingField: () => {
    if (!name.value.trim()) return 'name';
    if (!dose.value.trim()) return 'dose';
    if (!frequency.value.trim()) return 'frequency';
    return null;
  },
  buildPayload,
  create: (payload) => medicationsStore.createMedication(payload),
  update: (id, payload) => medicationsStore.updateMedication(id, payload),
});

const binding = usePhotoEntityBinding({
  entityId: eager.entityId,
  // Live photoIds from the doc — see ActivityModal for the rationale on
  // bypassing the prop snapshot.
  initialPhotoIds: () => photoStore.photoIdsFor('medications', eager.entityId.value),
  watchSource: () => props.medication?.id,
  update: (id, patch) => medicationsStore.updateMedication(id, patch),
  surface: 'MedicationFormModal',
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !props.medication) eager.reset();
  }
);

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const result = await eager.commit();
    if (!result) return; // store reported via wrapAsync; keep modal open for retry
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

async function handleAddFirstPhoto(): Promise<void> {
  const id = await eager.ensureId();
  if (!id) return;
  await nextTick();
  photoAttachmentsRef.value?.openPicker();
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

    <FormFieldGroup :label="t('medications.field.startDate')" optional>
      <BeanieDatePicker v-model="startDate" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('medications.field.schedule')">
      <TogglePillGroup v-model="schedule" :options="scheduleOptions" />
      <p
        v-if="ongoing"
        class="font-outfit mt-2 text-xs text-[var(--color-text-muted)] dark:text-gray-400"
      >
        {{ t('medications.schedule.ongoingHint') }}
      </p>
    </FormFieldGroup>

    <!-- End date only appears once the user chooses "has an end date",
         so there's no disabled, unexplained field. Required in this
         branch — enforced by canSave. -->
    <ConditionalSection :show="!ongoing">
      <FormFieldGroup :label="t('medications.field.endDate')" required>
        <!-- `:disabled="ongoing"` keeps the picker out of the tab order while
             the section is collapsed — ConditionalSection hides via max-height,
             not display:none, so without this a keyboard/SR user would still
             land on the invisible field. -->
        <BeanieDatePicker v-model="endDate" :disabled="ongoing" />
      </FormFieldGroup>
    </ConditionalSection>

    <FormFieldGroup :label="t('medications.field.notes')" optional>
      <BaseInput v-model="notes" :placeholder="t('medications.placeholder.notes')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('medications.field.photo')" optional>
      <div v-if="eager.entityId.value" class="photo-wrapper">
        <PhotoAttachments
          ref="photoAttachmentsRef"
          collection="medications"
          :entity-id="eager.entityId.value"
          :photo-ids="binding.photoIds.value"
          :current-member-id="currentMemberId"
          :max="1"
          @update:photo-ids="binding.updatePhotoIds"
        />
      </div>
      <button
        v-else
        type="button"
        class="hover:border-primary-500 hover:text-primary-500 flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canSave || eager.isCreating.value"
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
