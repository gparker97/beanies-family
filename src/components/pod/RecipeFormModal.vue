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
import RecipeSourceStrip from './RecipeSourceStrip.vue';
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useRecipeCapture } from '@/composables/useRecipeCapture';
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
import type { RecipePrefill } from '@/utils/recipeExtractionToRecipe';

const props = withDefaults(
  defineProps<{
    open: boolean;
    recipe?: Recipe | null;
    /** Stack above another open drawer/modal (e.g. opened from the meal editor). */
    layer?: 'base' | 'overlay';
    /**
     * Seed values from the AI recipe reader (#72). One prop, not three — it always
     * travels as a unit. Applied inside `useFormModal`'s `onNew`, never a second watcher
     * (see applyPrefill). Nothing is persisted until the user presses Save; this form IS
     * the review step.
     */
    prefill?: RecipePrefill | null;
  }>(),
  { recipe: null, layer: 'base', prefill: null }
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
const cookTime = ref('');
const servings = ref('');
const ingredientsText = ref('');
const stepsText = ref('');
const notes = ref('');

const sourceUrl = ref('');

/**
 * Seed the form from an AI prefill, or clear it when there is none. Passing `null` is the
 * blank-new-recipe case, so there is exactly one place that resets these refs.
 */
/**
 * A dish photo is queued and will attach itself on save.
 *
 * Set from the prefill rather than from the capture instance, because `applyPrefill` is the
 * one funnel BOTH routes go through — the host page's capture and this form's own. Reading
 * it off either capture instance would be right only half the time.
 */
const willAttachPhoto = ref(false);

function applyPrefill(prefill: RecipePrefill | null): void {
  willAttachPhoto.value = !!prefill?.dishImageUrl;
  const f = prefill?.fields;
  name.value = f?.name ?? '';
  subtitle.value = f?.subtitle ?? '';
  prepTime.value = f?.prepTime ?? '';
  cookTime.value = f?.cookTime ?? '';
  servings.value = f?.servings ?? '';
  ingredientsText.value = (f?.ingredients ?? []).join('\n');
  stepsText.value = (f?.steps ?? []).join('\n');
  notes.value = f?.notes ?? '';
  sourceUrl.value = f?.sourceUrl ?? '';
}

/**
 * Which lines the reader filled in itself. Derived from the PROP, never a `wasPrefilled`
 * ref — a ref would need clearing on close and would eventually be missed on one path.
 */
const inferredIngredients = computed(() => props.prefill?.inferredIngredients ?? []);
const inferredSteps = computed(() => props.prefill?.inferredSteps ?? []);

const { isEditing, isSubmitting } = useFormModal(
  () => props.recipe,
  () => props.open,
  {
    onEdit: (r) => {
      name.value = r.name;
      subtitle.value = r.subtitle ?? '';
      prepTime.value = r.prepTime ?? '';
      cookTime.value = r.cookTime ?? '';
      servings.value = r.servings ?? '';
      ingredientsText.value = (r.ingredients ?? []).join('\n');
      stepsText.value = (r.steps ?? []).join('\n');
      notes.value = r.notes ?? '';
      sourceUrl.value = r.sourceUrl ?? '';
    },
    // ONE reset path. A separate `watch(() => props.prefill)` would RACE this callback
    // (useFormModal fires it when `open` flips), and the resulting "sometimes the form
    // opens blank" bug is order-dependent and miserable to reproduce. applyPrefill(null)
    // IS the blank reset.
    onNew: () => applyPrefill(props.prefill),
  }
);

const canSave = computed(() => name.value.trim().length > 0);

/**
 * The shortcut band shows only on a genuinely blank ADD.
 *
 * Not when editing — offering to refill an existing recipe from a link invites overwriting
 * work the user already did. Not when a capture supplied the prefill — the shortcut has
 * already done its job and repeating the offer would be noise. And not once the user has
 * started typing, because at that point they have chosen the manual route and the band would
 * be nagging rather than helping.
 */
const showSourceStrip = computed(
  () => !isEditing.value && !props.prefill && name.value.trim().length === 0
);

const aiDocPicker = ref<InstanceType<typeof AiDocumentPicker> | null>(null);

/**
 * The form runs its OWN capture, and fills ITSELF in.
 *
 * The first version emitted `captureLink` upward and let the host page orchestrate. That
 * worked on the cookbook and silently did nothing everywhere else — the meal planner's
 * recipe rail, the meal editor, the favourite picker and the recipe detail page all open
 * this same modal, and none of them had the wiring. The affordance was visible and dead in
 * four places out of five, which is worse than not offering it.
 *
 * Owning it here means every caller gets it for free and no future caller can forget. The
 * orchestration still lives in the composable — the form is a view USING an orchestrator,
 * which is the MVO shape; it is only the delegation that was wrong.
 */
const capture = useRecipeCapture({
  onRecipeReady: ({ prefill }) => applyPrefill(prefill),
});

const modalTitle = computed(() =>
  isEditing.value ? t('recipes.editTitle') : t('recipes.addTitle')
);

function splitLines(s: string): string[] {
  return s
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * CLEARING A FIELD MUST ACTUALLY CLEAR IT.
 *
 * These optional fields used to be conditionally spread — omitted entirely when blank. On
 * create that is equivalent, but on UPDATE the repository leaves keys that are not present
 * untouched, so emptying a field in the edit form silently kept the old value. Deleting the
 * link greg asked for was impossible, and the same was quietly true of the subtitle, times,
 * servings and notes.
 *
 * Passing `undefined` is the repository's documented delete signal, and it is safe on both
 * paths: `create` runs the input through `stripUndefined`, and `update` collects undefined
 * keys and removes them from the doc.
 */
function orUndefined(v: string): string | undefined {
  return v.trim() || undefined;
}

function buildPayload() {
  return {
    name: name.value.trim(),
    subtitle: orUndefined(subtitle.value),
    prepTime: orUndefined(prepTime.value),
    cookTime: orUndefined(cookTime.value),
    servings: orUndefined(servings.value),
    sourceUrl: orUndefined(sourceUrl.value),
    ingredients: splitLines(ingredientsText.value),
    steps: splitLines(stepsText.value),
    notes: orUndefined(notes.value),
    // photoIds stays conditional: an empty array is a MEANINGFUL value here (the user
    // removed every photo), not an absent one, and PhotoAttachments owns that state.
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
    // Attach whatever OUR capture is holding. A no-op when the host page did the capture
    // instead — that instance holds the source and attaches it from `saved` below.
    void capture.attachAfterSave(result.id);
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

/**
 * Shared class for the two list textareas (ingredients / steps), hoisted so the inferred
 * hints attach consistently. NOT migrated to BaseTextarea in this change: its styling
 * differs deliberately (notes is font-caveat/text-lg, the lists are leading-relaxed), so a
 * swap is a visual change needing design sign-off. One place for a future migration.
 */
const LIST_TEXTAREA_CLASS =
  'focus:border-primary-500 focus:ring-primary-500 font-inter w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-relaxed text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100';
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
    <!-- `relative` so the reading overlay below anchors to the FORM BODY. The drawer and
         modal containers differ in whether they establish a positioning context, and an
         overlay that silently anchors to the viewport in one of them is the kind of bug
         that only shows up on one variant. -->
    <div class="relative">
      <RecipeSourceStrip
        v-if="showSourceStrip"
        @submit="(url) => void capture.processUrl(url)"
        @document="aiDocPicker?.pick()"
      />

      <!-- Reading blocks the form: every field is about to be overwritten, so letting the
           user type meanwhile would only throw their work away. -->
      <div
        v-if="capture.isProcessing.value"
        class="absolute inset-0 z-10 grid place-items-center rounded-[var(--sq)] bg-white/85 backdrop-blur-sm dark:bg-slate-900/85"
      >
        <div class="flex flex-col items-center gap-3">
          <BeanieSpinner size="lg" :halo="true" />
          <p class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-200">
            {{ t('ai.processing') }}
          </p>
        </div>
      </div>

      <AiDocumentPicker ref="aiDocPicker" @file="(f) => void capture.processFile(f)" />

      <FormFieldGroup :label="t('recipes.field.name')" required>
        <BaseInput v-model="name" :placeholder="t('recipes.placeholder.name')" />
      </FormFieldGroup>

      <FormFieldGroup :label="t('recipes.field.subtitle')" optional>
        <BaseInput v-model="subtitle" :placeholder="t('recipes.placeholder.subtitle')" />
      </FormFieldGroup>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormFieldGroup :label="t('recipes.field.prepTime')" optional>
          <BaseInput v-model="prepTime" :placeholder="t('recipes.placeholder.prepTime')" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('recipes.field.cookTime')" optional>
          <BaseInput v-model="cookTime" :placeholder="t('recipes.placeholder.cookTime')" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('recipes.field.servings')" optional>
          <BaseInput v-model="servings" :placeholder="t('recipes.placeholder.servings')" />
        </FormFieldGroup>
      </div>

      <FormFieldGroup :label="t('recipes.field.ingredients')" optional>
        <textarea
          v-model="ingredientsText"
          rows="6"
          :class="LIST_TEXTAREA_CLASS"
          :placeholder="t('recipes.placeholder.ingredients').replace(/\\n/g, '\n')"
        />
        <!-- Heritage Orange, never Alert Red: this is a routine "worth a look", not an
           error. Same idiom as ActivityModal's low-confidence hint. -->
        <p v-if="inferredIngredients.length" class="font-outfit text-primary-500 mt-1.5 text-xs">
          {{ t('recipeExtract.inferred.ingredients') }} {{ inferredIngredients.join(', ') }}
        </p>
      </FormFieldGroup>

      <FormFieldGroup :label="t('recipes.field.steps')" optional>
        <textarea
          v-model="stepsText"
          rows="6"
          :class="LIST_TEXTAREA_CLASS"
          :placeholder="t('recipes.placeholder.steps').replace(/\\n/g, '\n')"
        />
        <p v-if="inferredSteps.length" class="font-outfit text-primary-500 mt-1.5 text-xs">
          {{ t('recipeExtract.inferred.steps') }} {{ inferredSteps.join(', ') }}
        </p>
      </FormFieldGroup>

      <!-- Where this came from, visible and editable — the same affordance activities have.
           It is filled in automatically by the reader, but a hand-typed recipe can carry a
           link too, and a captured one can be corrected. -->
      <FormFieldGroup :label="t('recipes.field.sourceUrl')" optional>
        <BaseInput
          v-model="sourceUrl"
          type="url"
          :placeholder="t('recipes.placeholder.sourceUrl')"
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
        <template v-else>
          <!-- Say a photo is coming, and STILL offer the add control.
               The note removes the surprise, which was the actual problem — it is not a
               reason to take the choice away. Adding your own plate alongside the original
               is a normal thing to want, and the two cannot conflict: the captured photo is
               appended after save, so whichever photo the user adds first stays the hero. -->
          <p
            v-if="willAttachPhoto"
            class="font-outfit mb-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-[rgb(230_126_34_/_35%)] bg-[var(--tint-orange-4)] px-3 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]"
          >
            <span aria-hidden="true">✨</span>
            <span>{{ t('recipes.photos.willAttach') }}</span>
          </p>
          <button
            type="button"
            class="hover:border-primary-500 hover:text-primary-500 flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSave || eager.isCreating.value"
            @click="handleAddFirstPhoto"
          >
            <BeanieIcon name="camera" size="md" />
            <span class="font-outfit text-xs font-semibold">
              {{
                canSave
                  ? willAttachPhoto
                    ? t('recipes.photos.addAnother')
                    : t('photos.addPhoto')
                  : t('recipes.photos.saveFirst')
              }}
            </span>
          </button>
        </template>
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
