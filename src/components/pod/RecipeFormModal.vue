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
import type { Recipe, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  recipe?: Recipe | null;
}>();

const emit = defineEmits<{
  close: [];
  deleted: [id: UUID];
}>();

const { t } = useTranslation();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();

const name = ref('');
const subtitle = ref('');
const prepTime = ref('');
const servings = ref('');
const ingredientsText = ref('');
const stepsText = ref('');
const notes = ref('');
const photoIds = ref<UUID[]>([]);
const recipeId = ref<UUID | null>(null);

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
      photoIds.value = [...(r.photoIds ?? [])];
      recipeId.value = r.id;
    },
    onNew: () => {
      name.value = '';
      subtitle.value = '';
      prepTime.value = '';
      servings.value = '';
      ingredientsText.value = '';
      stepsText.value = '';
      notes.value = '';
      photoIds.value = [];
      recipeId.value = null;
    },
  }
);

// Keep a ref to the last-seen recipe prop so the photo panel stays
// bound to the right entityId when the parent swaps recipes between
// opens (e.g. from the cookbook grid).
watch(
  () => props.recipe?.id,
  (id) => {
    if (id && recipeId.value !== id) recipeId.value = id;
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
    ...(photoIds.value.length ? { photoIds: [...photoIds.value] } : {}),
  };
}

const photoAttachmentsRef = ref<{ openPicker: () => void } | null>(null);

async function ensureRecipeId(): Promise<UUID | null> {
  if (recipeId.value) return recipeId.value;
  if (!canSave.value) return null;
  const created = await recipesStore.createRecipe(buildPayload());
  if (!created) return null;
  recipeId.value = created.id;
  return created.id;
}

/**
 * Pre-save "Add Photo" handler — creates the recipe record if needed,
 * then opens the file picker in the freshly-mounted PhotoAttachments.
 * Single-click flow for users who want to attach a photo right away
 * rather than clicking "Add Photo" and then hunting for the picker.
 */
async function handleAddFirstPhoto(): Promise<void> {
  const id = await ensureRecipeId();
  if (!id) return;
  await nextTick();
  photoAttachmentsRef.value?.openPicker();
}

function updatePhotoIds(ids: UUID[]): void {
  photoIds.value = ids;
  const id = recipeId.value ?? props.recipe?.id;
  if (id) {
    // Persist the new photoIds eagerly so the Automerge record matches
    // what usePhotos has wired up. Other form fields still commit only
    // on explicit Save.
    void recipesStore.updateRecipe(id, { photoIds: ids });
  }
}

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const payload = buildPayload();
    if (isEditing.value && props.recipe) {
      await recipesStore.updateRecipe(props.recipe.id, payload);
    } else if (recipeId.value) {
      await recipesStore.updateRecipe(recipeId.value, payload);
    } else {
      await recipesStore.createRecipe(payload);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.recipe) return;
  const logCount = recipesStore.cookLogsByRecipe(props.recipe.id).value.length;
  // confirm() takes a `detail` string (plain, untranslated) in addition
  // to title + message. We use `detail` for the "this will also remove
  // N cook-log entries" warning so the count surfaces in the dialog.
  const detail =
    logCount > 0
      ? t('recipes.deleteConfirm.body')
          .replace('{count}', String(logCount))
          .replace(
            '{label}',
            logCount === 1 ? t('recipes.cookLogs.entry') : t('recipes.cookLogs.entries')
          )
      : undefined;
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

    <div class="grid grid-cols-2 gap-3">
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
        class="focus:border-primary-500 focus:ring-primary-500 font-inter w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-sm leading-relaxed text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('recipes.placeholder.ingredients').replace(/\\n/g, '\n')"
      />
    </FormFieldGroup>

    <FormFieldGroup :label="t('recipes.field.steps')" optional>
      <textarea
        v-model="stepsText"
        rows="6"
        class="focus:border-primary-500 focus:ring-primary-500 font-inter w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-sm leading-relaxed text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
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
      <div v-if="recipeId || recipe">
        <PhotoAttachments
          ref="photoAttachmentsRef"
          collection="recipes"
          :entity-id="(recipeId ?? recipe?.id) as UUID"
          :photo-ids="photoIds"
          :current-member-id="currentMemberId"
          :max="4"
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
          {{ canSave ? t('photos.addPhoto') : t('recipes.photos.saveFirst') }}
        </span>
      </button>
    </FormFieldGroup>
  </BeanieFormModal>
</template>
