<script setup lang="ts">
/**
 * Add/edit a Recipe — name, subtitle, prep time, servings, ingredients,
 * steps, family notes, and up to four photos. Ingredients and steps are
 * edited as newline-separated text for speed; we split on save.
 *
 * New-recipe photo attachment mirrors MedicationFormModal's eager-create
 * pattern — PhotoAttachments needs a real entityId, so the first photo
 * pick saves a bare draft record with whatever's in the form so far and
 * flips the modal into edit mode. If the user cancels after attaching a
 * photo, the orphan photo is tombstone-GC'd after 24h; the recipe
 * itself stays until explicitly deleted.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import PhotoAttachments from '@/components/media/PhotoAttachments.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { confirm } from '@/composables/useConfirm';
import { countMealsForRecipe } from '@/services/automerge/repositories/mealPlanRepository';
import { fillTemplate } from '@/utils/fillTemplate';
import { useEagerEntityCreate } from '@/composables/useEagerEntityCreate';
import { usePhotoEntityBinding } from '@/composables/usePhotoEntityBinding';
import { usePhotoStore } from '@/stores/photoStore';
import type { Recipe, UUID } from '@/types/models';

const props = withDefaults(
  defineProps<{
    open: boolean;
    recipe?: Recipe | null;
    /** Stack above another open drawer/modal (e.g. opened from the meal editor). */
    layer?: 'base' | 'overlay';
  }>(),
  { recipe: null, layer: 'base' }
);

const emit = defineEmits<{
  close: [];
  deleted: [id: UUID];
  /** Emitted with the recipe id after a successful create OR update.
   *  Callers (e.g. FavoriteFormModal's "+ Add a new recipe" flow)
   *  listen for this to auto-link the new recipe to whatever workflow
   *  opened the form. */
  saved: [id: UUID];
}>();

const { t } = useTranslation();
const recipesStore = useRecipesStore();
const photoStore = usePhotoStore();
const familyStore = useFamilyStore();

const name = ref('');
const subtitle = ref('');
const prepTime = ref('');
const servings = ref('');
const ingredientsText = ref('');
const stepsText = ref('');
const notes = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.recipe,
  () => props.open,
  {
    onEdit: (r) => {
      name.value = r.name;
      subtitle.value = r.subtitle ?? '';
      prepTime.value = r.prepTime ?? '';
      servings.value = r.servings ?? '';
      ingredientsText.value = (r.ingredients ?? []).join('\n');
      stepsText.value = (r.steps ?? []).join('\n');
      notes.value = r.notes ?? '';
    },
    onNew: () => {
      name.value = '';
      subtitle.value = '';
      prepTime.value = '';
      servings.value = '';
      ingredientsText.value = '';
      stepsText.value = '';
      notes.value = '';
    },
  }
);

const canSave = computed(() => name.value.trim().length > 0);

const modalTitle = computed(() =>
  isEditing.value ? t('recipes.editTitle') : t('recipes.addTitle')
);

function splitLines(s: string): string[] {
  return s
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function buildPayload() {
  return {
    name: name.value.trim(),
    ...(subtitle.value.trim() ? { subtitle: subtitle.value.trim() } : {}),
    ...(prepTime.value.trim() ? { prepTime: prepTime.value.trim() } : {}),
    ...(servings.value.trim() ? { servings: servings.value.trim() } : {}),
    ingredients: splitLines(ingredientsText.value),
    steps: splitLines(stepsText.value),
    ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
    ...(binding.photoIds.value.length ? { photoIds: [...binding.photoIds.value] } : {}),
  };
}

/**
 * Eager-create + photo-binding wiring.
 *
 * Eager-create gates on `canSave` (recipe name is the only required
 * field). The placeholder label flips between "Add photo" and the
 * "save first" hint based on the same predicate.
 */
const photoAttachmentsRef = ref<{ openPicker: () => void } | null>(null);

const eager = useEagerEntityCreate<Recipe, ReturnType<typeof buildPayload>>({
  resolveExistingId: () => props.recipe?.id ?? null,
  firstMissingField: () => (name.value.trim() ? null : 'name'),
  buildPayload,
  create: (payload) => recipesStore.createRecipe(payload),
  update: (id, payload) => recipesStore.updateRecipe(id, payload),
});

const binding = usePhotoEntityBinding({
  entityId: eager.entityId,
  // Live photoIds from the doc — see ActivityModal for the rationale on
  // bypassing the prop snapshot.
  initialPhotoIds: () => photoStore.photoIdsFor('recipes', eager.entityId.value),
  watchSource: () => props.recipe?.id,
  update: (id, patch) => recipesStore.updateRecipe(id, patch),
  surface: 'RecipeFormModal',
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !props.recipe) eager.reset();
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
  isSubmitting.value = true;
  try {
    const result = await eager.commit();
    if (!result) return; // store reported via wrapAsync; keep modal open for retry
    emit('saved', result.id);
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.recipe) return;
  const logCount = recipesStore.cookLogsByRecipe(props.recipe.id).value.length;
  const mealCount = countMealsForRecipe(props.recipe.id);
  // confirm() takes a `detail` string (plain, untranslated) in addition to
  // title + message. We surface both counts there: the cook-log removal and,
  // when the recipe is used in meal plans, the "marks those meals as recipe
  // removed" warning (the meals themselves are kept; cook logs are kept).
  const detailParts: string[] = [];
  if (logCount > 0) {
    detailParts.push(
      t('recipes.deleteConfirm.body')
        .replace('{count}', String(logCount))
        .replace(
          '{label}',
          logCount === 1 ? t('recipes.cookLogs.entry') : t('recipes.cookLogs.entries')
        )
    );
  }
  if (mealCount > 0) {
    detailParts.push(fillTemplate(t('mealPlanner.recipeDelete.message'), { count: mealCount }));
  }
  const detail = detailParts.length ? detailParts.join(' ') : undefined;
  const ok = await confirm({
    title: 'recipes.deleteConfirm.title',
    message: logCount > 0 ? 'recipes.deleteConfirm.body' : 'recipes.deleteConfirm.bodyNoLogs',
    detail,
    variant: 'danger',
  });
  if (!ok) return;
  const id = props.recipe.id;
  await recipesStore.deleteRecipeCascade(id);
  emit('deleted', id);
  emit('close');
}

const currentMemberId = computed(() => familyStore.currentMember?.id);
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :layer="layer"
    :open="open"
    :title="modalTitle"
    icon="🍝"
    icon-bg="var(--tint-orange-8)"
    size="default"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('recipes.field.name')" required>
      <BaseInput v-model="name" :placeholder="t('recipes.placeholder.name')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('recipes.field.subtitle')" optional>
      <BaseInput v-model="subtitle" :placeholder="t('recipes.placeholder.subtitle')" />
    </FormFieldGroup>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormFieldGroup :label="t('recipes.field.prepTime')" optional>
        <BaseInput v-model="prepTime" :placeholder="t('recipes.placeholder.prepTime')" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('recipes.field.servings')" optional>
        <BaseInput v-model="servings" :placeholder="t('recipes.placeholder.servings')" />
      </FormFieldGroup>
    </div>

    <FormFieldGroup :label="t('recipes.field.ingredients')" optional>
      <textarea
        v-model="ingredientsText"
        rows="6"
        class="focus:border-primary-500 focus:ring-primary-500 font-inter w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-relaxed text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('recipes.placeholder.ingredients').replace(/\\n/g, '\n')"
      />
    </FormFieldGroup>

    <FormFieldGroup :label="t('recipes.field.steps')" optional>
      <textarea
        v-model="stepsText"
        rows="6"
        class="focus:border-primary-500 focus:ring-primary-500 font-inter w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-relaxed text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('recipes.placeholder.steps').replace(/\\n/g, '\n')"
      />
    </FormFieldGroup>

    <FormFieldGroup :label="t('recipes.field.notes')" optional>
      <textarea
        v-model="notes"
        rows="3"
        class="focus:border-primary-500 focus:ring-primary-500 font-caveat w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-lg leading-snug text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('recipes.placeholder.notes')"
      />
    </FormFieldGroup>

    <FormFieldGroup :label="t('recipes.field.photos')" optional>
      <div v-if="eager.entityId.value">
        <PhotoAttachments
          ref="photoAttachmentsRef"
          collection="recipes"
          :entity-id="eager.entityId.value"
          :photo-ids="binding.photoIds.value"
          :current-member-id="currentMemberId"
          :max="4"
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
          {{ canSave ? t('photos.addPhoto') : t('recipes.photos.saveFirst') }}
        </span>
      </button>
    </FormFieldGroup>
  </BeanieFormModal>
</template>
