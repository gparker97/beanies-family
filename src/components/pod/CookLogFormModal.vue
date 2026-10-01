<script setup lang="ts">
/**
 * Add/edit a CookLogEntry. Date, cook, servings, 5-star rating, "what
 * went well", "what to try next time", and an optional dish photo
 * (max 1). On a 5-star save we fire the `recipe-5star` celebration.
 *
 * Rating defaults to 5 on the add path per the plan's form-defaults
 * table — most cooks that get logged were good cooks, so one-click
 * happy path for the common case.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import PhotoAttachments from '@/components/media/PhotoAttachments.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { orUndefined } from '@/utils/diffPayload';
import { useFormModal } from '@/composables/useFormModal';
import { useEagerEntityCreate } from '@/composables/useEagerEntityCreate';
import { usePhotoEntityBinding } from '@/composables/usePhotoEntityBinding';
import { usePhotoStore } from '@/stores/photoStore';
import { useTranslation } from '@/composables/useTranslation';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { confirm } from '@/composables/useConfirm';
import { celebrate } from '@/composables/useCelebration';
import { toDateInputValue } from '@/utils/date';
import type { CookLogEntry, CookLogRating, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  recipeId: UUID;
  entry?: CookLogEntry | null;
  /** New-entry defaults (e.g. the meal planner logs the meal's date + assigned cook). */
  presetCookedOn?: string;
  presetCookedBy?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();
const photoStore = usePhotoStore();

const cookedOn = ref('');
const cookedBy = ref<string>('');
const rating = ref<CookLogRating>(5);
const servings = ref('');
const wentWell = ref('');
const toImprove = ref('');

const cookOptions = computed(() => [
  { value: '', label: t('cookLog.byline.someone') },
  // Humans only — pets don't cook.
  ...familyStore.humans.map((m) => ({ value: m.id, label: m.name })),
]);

const { isEditing, isSubmitting, formDiff } = useFormModal<CookLogEntry, CookLogPayload>(
  () => props.entry,
  () => props.open,
  {
    onEdit: (c) => {
      cookedOn.value = c.cookedOn;
      cookedBy.value = c.cookedBy ?? '';
      rating.value = c.rating;
      servings.value = c.servings ?? '';
      wentWell.value = c.wentWell ?? '';
      toImprove.value = c.toImprove ?? '';
    },
    onNew: () => {
      cookedOn.value = props.presetCookedOn ?? toDateInputValue(new Date());
      cookedBy.value = props.presetCookedBy ?? familyStore.currentMember?.id ?? '';
      rating.value = 5;
      servings.value = '';
      wentWell.value = '';
      toImprove.value = '';
    },
    snapshot: { build: buildPayload, name: 'CookLogFormModal' },
  }
);

const canSave = computed(() => cookedOn.value.length > 0 && rating.value >= 1);

const modalTitle = computed(() =>
  isEditing.value ? t('cookLog.editTitle') : t('cookLog.addTitle')
);

// Every field is emitted (`undefined` when blank) so an edit can clear it; the snapshot diff
// keeps untouched blanks out of the write. No `photoIds`: the binding is the only writer.
function buildPayload() {
  return {
    recipeId: props.recipeId,
    cookedOn: cookedOn.value,
    rating: rating.value,
    cookedBy: cookedBy.value || undefined,
    servings: orUndefined(servings.value),
    wentWell: orUndefined(wentWell.value),
    toImprove: orUndefined(toImprove.value),
  };
}
type CookLogPayload = ReturnType<typeof buildPayload>;

const photoAttachmentsRef = ref<{ openPicker: () => void } | null>(null);

// Eager-create gates on the same rule as Save, so a photo can attach as soon as the entry is
// well-formed enough to save.
const eager = useEagerEntityCreate<CookLogEntry, CookLogPayload>({
  resolveExistingId: () => props.entry?.id ?? null,
  firstMissingField: () => (canSave.value ? null : 'cookedOn'),
  buildPayload,
  create: (payload) => recipesStore.createCookLog(payload),
  update: (id, payload) => recipesStore.updateCookLog(id, payload),
  formDiff,
});

const binding = usePhotoEntityBinding({
  entityId: eager.entityId,
  // Live photoIds from the doc, so a photo that lands after the drawer closed still shows.
  initialPhotoIds: () => photoStore.photoIdsFor('cookLogs', eager.entityId.value),
  watchSource: () => props.entry?.id,
  update: (id, patch) => recipesStore.updateCookLog(id, patch),
  surface: 'CookLogFormModal',
});

// A closed-then-reopened modal must not keep targeting the previous eager-created entry.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !props.entry) eager.reset();
  }
);

async function handleAddFirstPhoto(): Promise<void> {
  const id = await eager.ensureId();
  if (!id) return;
  await nextTick();
  photoAttachmentsRef.value?.openPicker();
}

function setRating(n: number): void {
  rating.value = Math.max(1, Math.min(5, n)) as CookLogRating;
}

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const wasFiveStar = rating.value === 5;
    const wasAlreadyFiveStar = props.entry?.rating === 5;
    const result = await eager.commit();
    if (!result) return; // store reported via wrapAsync; keep modal open for retry
    // Fire the celebration only on NEW 5-star entries (creation or an
    // edit that flipped from <5 to 5). Editing a 5-star log keeps the
    // existing 5 and shouldn't re-celebrate.
    if (wasFiveStar && !wasAlreadyFiveStar) {
      celebrate('recipe-5star');
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.entry) return;
  const ok = await confirm({
    title: 'cookLog.deleteConfirm.title',
    message: 'cookLog.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await recipesStore.deleteCookLog(props.entry.id);
  emit('close');
}

const currentMemberId = computed(() => familyStore.currentMember?.id);
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="modalTitle"
    icon="🍳"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('cookLog.field.rating')" required>
      <div class="flex items-center gap-1">
        <button
          v-for="n in 5"
          :key="n"
          type="button"
          class="rounded-lg p-1 text-3xl leading-none transition-transform hover:scale-110 focus:outline-none"
          :aria-label="`${n} star${n === 1 ? '' : 's'}`"
          :aria-pressed="rating >= n"
          @click="setRating(n)"
        >
          <span :class="rating >= n ? 'grayscale-0' : 'opacity-30 grayscale'">⭐</span>
        </button>
      </div>
    </FormFieldGroup>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormFieldGroup :label="t('cookLog.field.cookedOn')" required>
        <BeanieDatePicker v-model="cookedOn" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('cookLog.field.cookedBy')" optional>
        <BaseSelect v-model="cookedBy" :options="cookOptions" />
      </FormFieldGroup>
    </div>

    <FormFieldGroup :label="t('cookLog.field.servings')" optional>
      <BaseInput v-model="servings" :placeholder="t('cookLog.placeholder.servings')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('cookLog.field.wentWell')" optional>
      <BaseInput v-model="wentWell" :placeholder="t('cookLog.placeholder.wentWell')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('cookLog.field.toImprove')" optional>
      <BaseInput v-model="toImprove" :placeholder="t('cookLog.placeholder.toImprove')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('cookLog.field.photo')" optional>
      <div v-if="eager.entityId.value">
        <PhotoAttachments
          ref="photoAttachmentsRef"
          collection="cookLogs"
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
        class="hover:border-primary-500 hover:text-primary-500 dark:hover:text-accent-lift flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!canSave || eager.isCreating.value"
        @click="handleAddFirstPhoto"
      >
        <BeanieIcon name="camera" size="md" />
        <span class="font-outfit text-xs font-semibold">
          {{ canSave ? t('photos.addPhoto') : t('cookLog.photos.saveFirst') }}
        </span>
      </button>
    </FormFieldGroup>
  </BeanieFormModal>
</template>
