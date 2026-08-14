<script setup lang="ts">
/**
 * Add/edit a Milestone — bean (or family-wide), category, title, date,
 * optional description, optional photos.
 *
 * Field order follows the natural mental model:
 *   1. WHO — bean chip rail at top + "Family" chip for family-wide moments
 *   2. WHAT — category picker grouped into Firsts / Achievements /
 *      Family / Celebrations (group headers self-label so no "Category"
 *      wrapper field needed)
 *   3. WHAT specifically — title (auto-fills from category when empty)
 *   4. WHEN — date (defaults today)
 *   5. Anything to remember — description, photos
 *
 * Photos use the eager-create-on-tap pattern from `MedicationFormModal`:
 * tapping "Add photos" with valid title+date silently saves the record so
 * `<PhotoAttachments>` has an `entityId` to bind to. Subsequent saves
 * update the same record. Trade-off: a user who attaches a photo and
 * then closes the modal leaves an orphan record in the doc — same trade
 * accepted by the medication form. Worth it for the better flow.
 *
 * Title pre-fill rule: only fills when title is empty. Switching
 * categories never overwrites a non-empty user-typed title.
 *
 * Date validity is checked explicitly on submit; <input type="date">
 * filters most invalid input but paste / programmatic flows can still
 * land bad strings here.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import GroupedChipPicker from '@/components/ui/GroupedChipPicker.vue';
import type { ChipGroup } from '@/components/ui/GroupedChipPicker.vue';
import PhotoAttachments from '@/components/media/PhotoAttachments.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useMilestonesStore } from '@/stores/milestonesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { useEagerEntityCreate } from '@/composables/useEagerEntityCreate';
import { usePhotoEntityBinding } from '@/composables/usePhotoEntityBinding';
import { usePhotoStore } from '@/stores/photoStore';
import { toDateInputValue } from '@/utils/date';
import { MILESTONE_CATEGORIES, MILESTONE_CATEGORY_GROUPS } from '@/constants/milestoneCategories';
import type { Milestone, MilestoneCategory, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  /**
   * Initial bean selection. `null` = no pre-selection (user must pick
   * via the bean chip rail before saving). A specific UUID pre-selects
   * that bean (used by callers that already know the context, e.g.
   * BeanMilestonesTab on a member's pod, or the FAB → bean-picker
   * flow which pre-resolves the bean before opening the modal).
   */
  memberId: UUID | null;
  milestone?: Milestone | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t, isBeanieMode } = useTranslation();
const milestonesStore = useMilestonesStore();
const photoStore = usePhotoStore();
const familyStore = useFamilyStore();

/**
 * Selection state — three values for `selectedMemberId`:
 *   - undefined: nothing picked yet (chip rail shows nothing highlighted)
 *   - null: "Family" picked (family-wide milestone)
 *   - UUID: a specific bean picked
 *
 * `category` starts as empty string so no group is auto-expanded — the
 * user picks intentionally (matches transactions / activities behaviour).
 * Falls back to `'custom'` on save if still empty.
 */
const selectedMemberId = ref<UUID | null | undefined>(undefined);
const category = ref<MilestoneCategory | ''>('');
const title = ref('');
const occurredOn = ref('');
const description = ref('');
const dateError = ref<string | null>(null);

const photoAttachmentsRef = ref<{ openPicker: () => void } | null>(null);

// Single chip group containing the "Firsts" auto-expanded set + the rest
// behind expandable group headers. Maps the structured MILESTONE_CATEGORIES
// list into the ChipGroup shape GroupedChipPicker expects.
const chipGroups = computed<ChipGroup[]>(() =>
  MILESTONE_CATEGORY_GROUPS.map((group) => {
    const groupLabel = t(group.titleKey);
    return {
      name: isBeanieMode.value ? groupLabel.toLowerCase() : groupLabel,
      icon: group.emoji,
      items: MILESTONE_CATEGORIES.filter((c) => c.group === group.id).map((c) => {
        const label = t(c.titleKey);
        return {
          value: c.id,
          label: isBeanieMode.value ? label.toLowerCase() : label,
          icon: c.emoji,
        };
      }),
    };
  })
);

// Title pre-fill on category change — only when title is empty AND a
// real category is picked. Preserves user-typed titles deterministically
// across category changes; never fires for the empty-string default.
watch(category, (newCat) => {
  if (!newCat) return;
  if (title.value.trim() !== '') return;
  const cat = MILESTONE_CATEGORIES.find((c) => c.id === newCat);
  if (cat) title.value = t(cat.titleKey);
});

const { isEditing, isSubmitting } = useFormModal(
  () => props.milestone,
  () => props.open,
  {
    onEdit: (m) => {
      selectedMemberId.value = m.memberId;
      category.value = m.category;
      title.value = m.title;
      occurredOn.value = m.occurredOn;
      description.value = m.description ?? '';
      dateError.value = null;
    },
    onNew: () => {
      // Pre-select the bean only when the caller supplied one. A null
      // memberId prop = "no pre-selection" — the chip rail starts empty
      // and the user must pick a bean (or Family) before saving.
      selectedMemberId.value = props.memberId === null ? undefined : props.memberId;
      category.value = '';
      title.value = '';
      occurredOn.value = toDateInputValue(new Date());
      description.value = '';
      dateError.value = null;
    },
  }
);

const canSave = computed(
  () =>
    // Bean OR family-wide must be explicitly chosen — `undefined` = no pick yet.
    selectedMemberId.value !== undefined &&
    title.value.trim().length > 0 &&
    occurredOn.value.length > 0 &&
    !dateError.value
);

const modalTitle = computed(() =>
  isEditing.value ? t('milestone.editTitle') : t('milestone.addTitle')
);

function isMemberSelected(id: UUID | null): boolean {
  return selectedMemberId.value === id;
}

function selectMember(id: UUID | null): void {
  selectedMemberId.value = id;
}

function validateDate(): boolean {
  if (!occurredOn.value) {
    dateError.value = t('milestone.invalidDate');
    return false;
  }
  // <input type="date"> filters most invalid input; paste / programmatic
  // edits can still land here. Be explicit.
  const parsed = Date.parse(occurredOn.value);
  if (!Number.isFinite(parsed)) {
    dateError.value = t('milestone.invalidDate');
    return false;
  }
  dateError.value = null;
  return true;
}

watch(occurredOn, () => {
  // Clear the inline error as the user types — re-validate only on submit.
  if (dateError.value) dateError.value = null;
});

function buildPayload() {
  // selectedMemberId is `undefined` when the user hasn't picked yet —
  // `canSave` blocks save in that case, so this code path is only
  // reachable when the value is null (Family) or a UUID.
  const memberId = selectedMemberId.value ?? null;
  return {
    memberId,
    // Empty category means the user opened the form, attached a photo
    // (eager-create path), and didn't pick a category. Default to
    // 'custom' so the milestone is well-formed; the user can edit later.
    category: (category.value || 'custom') as MilestoneCategory,
    // Same fallback for title — only reachable via the eager-create
    // path with an unfilled title.
    title: title.value.trim() || t('milestone.cat.custom'),
    occurredOn: occurredOn.value || toDateInputValue(new Date()),
    ...(description.value.trim() ? { description: description.value.trim() } : {}),
    ...(binding.photoIds.value.length ? { photoIds: [...binding.photoIds.value] } : {}),
  };
}

/**
 * Eager-create + photo-binding wiring.
 *
 * Eager-create gates on "bean or Family picked" — date defaults to today
 * on form mount so it's effectively always valid; if a paste-corrupted
 * value lands in the date field, `canSave` blocks the final Save anyway.
 *
 * If the user attaches a photo and then closes the modal without saving,
 * an orphan record stays in the doc with the default title — same trade-
 * off accepted by every other entity using this composable. The orphan
 * photo itself is GC'd after 24h via the photoStore tombstone sweep;
 * the bare entity remains until explicitly deleted.
 */
const eager = useEagerEntityCreate<Milestone, ReturnType<typeof buildPayload>>({
  resolveExistingId: () => props.milestone?.id ?? null,
  firstMissingField: () => (selectedMemberId.value === undefined ? 'member' : null),
  buildPayload,
  create: (payload) => milestonesStore.createMilestone(payload),
  update: (id, payload) => milestonesStore.updateMilestone(id, payload),
});

const binding = usePhotoEntityBinding({
  entityId: eager.entityId,
  // Live photoIds from the doc — see ActivityModal for the rationale on
  // bypassing the prop snapshot (background upload completes while drawer
  // is closed; in-memory entity store doesn't auto-sync from doc).
  initialPhotoIds: () => photoStore.photoIdsFor('milestones', eager.entityId.value),
  watchSource: () => props.milestone?.id,
  update: (id, patch) => milestonesStore.updateMilestone(id, patch),
  surface: 'MilestoneFormModal',
});

// Reset the eager-create cache when the modal opens for a new milestone,
// so a closed-then-reopened modal doesn't keep targeting the previous
// eager-created record. Watching `props.open` after the composable is
// declared keeps the order constraint clean.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !props.milestone) eager.reset();
  }
);

async function handleAddFirstPhoto(): Promise<void> {
  const id = await eager.ensureId();
  if (!id) return;
  await nextTick();
  photoAttachmentsRef.value?.openPicker();
}

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  if (!validateDate()) return;
  isSubmitting.value = true;
  try {
    const result = await eager.commit();
    if (!result) {
      // Store action failed — wrapAsync already reported. Keep the modal
      // open so the user can retry without losing input. The store also
      // surfaces its own toast via the wrapAsync path.
      return;
    }
    emit('close');
  } catch (e) {
    console.error('[MilestoneFormModal] unexpected save rejection', e);
    showToast('error', t('error.milestoneSaveFailed'), t('error.milestoneSaveFailedHelp'), {
      error: e,
    });
    reportError({
      surface: 'MilestoneFormModal',
      message: 'unexpected save rejection',
      error: e,
    });
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.milestone) return;
  const ok = await confirm({
    title: 'milestone.deleteConfirm.title',
    message: 'milestone.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await milestonesStore.deleteMilestone(props.milestone.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="modalTitle"
    icon="🌟"
    icon-bg="var(--tint-silk-20)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <!-- 1. WHO — bean chip rail (single-select; "Family" = memberId null) -->
    <FormFieldGroup :label="t('milestone.field.for')" required>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="m in familyStore.sortedMembers"
          :key="m.id"
          type="button"
          class="font-outfit inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            isMemberSelected(m.id)
              ? 'bg-primary-500 border-transparent text-white'
              : 'text-secondary-500 border-[var(--tint-slate-10)] bg-white hover:bg-[var(--tint-orange-4)] dark:bg-slate-700 dark:text-gray-200'
          "
          @click="selectMember(m.id)"
        >
          <span
            class="inline-block h-3.5 w-3.5 flex-shrink-0 rounded-md"
            :style="{ backgroundColor: m.color }"
            aria-hidden="true"
          />
          <span>{{ m.name }}</span>
        </button>
        <button
          type="button"
          class="font-outfit inline-flex items-center gap-1.5 rounded-xl border-2 px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            isMemberSelected(null)
              ? 'bg-primary-500 border-transparent text-white'
              : 'text-secondary-500 border-[var(--tint-slate-10)] bg-white hover:bg-[var(--tint-orange-4)] dark:bg-slate-700 dark:text-gray-200'
          "
          @click="selectMember(null)"
        >
          <span aria-hidden="true">🏡</span>
          <span>{{ t('milestone.familyChip') }}</span>
        </button>
      </div>
    </FormFieldGroup>

    <!-- 2. WHAT — category picker (4 grouped chips, no top-level wrapper label) -->
    <FormFieldGroup :label="t('milestone.field.milestone')" optional>
      <GroupedChipPicker v-model="category" :groups="chipGroups" />
    </FormFieldGroup>

    <!-- 3. WHAT specifically — title -->
    <FormFieldGroup :label="t('milestone.field.title')" required>
      <BaseInput v-model="title" :placeholder="t('milestone.placeholder.title')" />
    </FormFieldGroup>

    <!-- 4. WHEN -->
    <FormFieldGroup :label="t('milestone.field.date')" required>
      <BeanieDatePicker v-model="occurredOn" />
      <p
        v-if="dateError"
        class="font-outfit mt-1 text-xs text-red-600 dark:text-red-400"
        role="alert"
      >
        {{ dateError }}
      </p>
    </FormFieldGroup>

    <!-- 5. Details -->
    <FormFieldGroup :label="t('milestone.field.description')" optional>
      <textarea
        v-model="description"
        rows="3"
        class="focus:border-primary-500 focus:ring-primary-500 font-outfit w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-snug text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('milestone.placeholder.description')"
      />
    </FormFieldGroup>

    <FormFieldGroup :label="t('milestone.field.photos')" optional>
      <!-- Once we have a milestoneId (eager-create or edit path), bind
           PhotoAttachments. Otherwise show the placeholder add-photo
           button — tapping eager-creates and opens the picker. -->
      <PhotoAttachments
        v-if="eager.entityId.value"
        ref="photoAttachmentsRef"
        :entity-id="eager.entityId.value"
        collection="milestones"
        :photo-ids="binding.photoIds.value"
        @update:photo-ids="binding.updatePhotoIds"
      />
      <!-- Pre-save: tap to eager-create + open the photo picker. The only
           gate is "bean or family picked" — everything else defaults so
           the user can attach a photo first and fill in details later. -->
      <button
        v-else
        type="button"
        :disabled="selectedMemberId === undefined || eager.isCreating.value"
        class="font-outfit text-secondary-500 hover:border-primary-500 hover:text-primary-500 flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-200"
        @click="handleAddFirstPhoto"
      >
        <span class="text-2xl" aria-hidden="true">📷</span>
        <span class="text-xs font-semibold">
          {{ t('milestone.addPhotos') }}
        </span>
      </button>
      <p
        v-if="selectedMemberId === undefined"
        class="font-outfit mt-1 text-[0.6875rem] text-[var(--color-text-muted)] italic dark:text-gray-400"
      >
        {{ t('milestone.addPhotosHint') }}
      </p>
    </FormFieldGroup>
  </BeanieFormModal>
</template>
