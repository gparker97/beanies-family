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
import FormSection from '@/components/ui/FormSection.vue';
import RecipeSourceStrip from './RecipeSourceStrip.vue';
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useRecipeCapture } from '@/composables/useRecipeCapture';
import type { DishImagePrefill } from '@/types/magicPayload';
import { diffPayload } from '@/utils/diffPayload';
import { useDocumentConsent, type ConsentGrant } from '@/composables/useDocumentConsent';
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
import BaseSelect from '@/components/ui/BaseSelect.vue';
import ChipToggleGroup from '@/components/ui/ChipToggleGroup.vue';
import type { ChipOption } from '@/components/ui/FrequencyChips.vue';
import RecipeTagInput from '@/components/pod/RecipeTagInput.vue';
import { COURSE_DEFS } from '@/constants/recipeCourses';
import { MEAL_SLOTS, SLOT_EMOJI, SLOT_LABEL_KEYS, sortSlots } from '@/constants/mealSlots';
import { useRecipeCourseLabel } from '@/composables/useRecipeCourseLabel';
import { suggestTags } from '@/utils/recipeTags';
import type { MealSlot, Recipe, RecipeCourse, UUID } from '@/types/models';
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
 * Course, meals and tags (#87).
 *
 * 🚨 THESE MUST BE SEEDED AND SAVED IN ALL FOUR PLACES — `onEdit`, `applyPrefill`,
 * `baselinePayload` and `buildPayload`. Miss `onEdit` and the failure is catastrophic and
 * silent: opening a saved recipe leaves these blank, `buildPayload` sends ''/[],
 * `baselinePayload` reports the STORED values, `diffPayload` sees a real change and writes the
 * clear — so fixing a typo in the title would erase that recipe's tags, course and meals.
 */
const course = ref<RecipeCourse | ''>('');
const mealSlots = ref<MealSlot[]>([]);
const tags = ref<string[]>([]);

/**
 * Seed the form from an AI prefill, or clear it when there is none. Passing `null` is the
 * blank-new-recipe case, so there is exactly one place that resets these refs.
 */
/**
 * The dish photo candidates for the recipe currently on screen, and their provenance.
 *
 * ⚠️ THIS COMPONENT IS THE SOLE OWNER OF THE DISH ATTACH, on every route (#86 §7).
 *
 * Two `useRecipeCapture` instances exist and BOTH run an attach for a single save — this
 * one's `handleSave`, and `FamilyCookbookPage.handleSaved` off the `saved` emit. That is safe
 * today only because the source file is composable-LOCAL, so the instance that did not
 * capture holds nothing. The dish candidates cannot work that way: `applyPrefill` is
 * deliberately fed by BOTH routes, so if this ref were also read by the page's instance the
 * photo would be fetched and stored twice — two photos on the recipe, two of the four-photo
 * cap consumed, and two `image_resolved` events inflating the very hit-rate metric the work
 * exists to create.
 *
 * The fix is ownership, not a guard: `handleSave` is the only expression in the codebase that
 * passes candidates to `attachAfterSave`. `FamilyCookbookPage.handleSaved` deliberately calls
 * it with no second argument.
 *
 * Set from the prefill rather than from the capture instance, because `applyPrefill` is the
 * one funnel BOTH routes go through — reading it off either capture instance would be right
 * only half the time.
 */
const dishImage = ref<DishImagePrefill | null>(null);

/**
 * A dish photo is queued and will attach itself on save.
 *
 * DERIVED, not a second ref: two values that must be kept in step are two places to forget,
 * and one of them would eventually be missed on one path.
 */
const willAttachPhoto = computed(() => (dishImage.value?.candidates.length ?? 0) > 0);

/**
 * The model-inferred lists, from WHICHEVER route delivered the prefill.
 *
 * These were computed off `props.prefill`, which only the host page sets — so a capture
 * started from this form's own shortcut band filled the fields but never rendered the
 * "beanies filled this in, check it" hints, presenting an inferred quantity as if it had
 * been read verbatim. Two visually identical entry points, different disclosure. Same trap
 * `willAttachPhoto` hit; these were left behind when that one was fixed.
 */
const localInferredIngredients = ref<string[]>([]);
const localInferredSteps = ref<string[]>([]);

function applyPrefill(prefill: RecipePrefill | null): void {
  dishImage.value = prefill?.dishImage ?? null;
  localInferredIngredients.value = prefill?.inferredIngredients ?? [];
  localInferredSteps.value = prefill?.inferredSteps ?? [];
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
  // 🚨 SITES 2 AND 5 OF 5. `applyPrefill` has TWO callers with OPPOSITE intents, and the
  // plan's four-site analysis missed the second one:
  //   - `onNew` passes null — the blank reset. Everything must clear.
  //   - `onRecipeReady` passes a real prefill INTO A FORM THE USER MAY ALREADY HAVE TYPED IN.
  //     `showSourceStrip` (:240) only hides once `name` is non-empty, so ticking "Dinner" and
  //     typing a tag BEFORE pasting a recipe URL is a perfectly normal order of operations.
  //
  // Every other field above is replaced by a value the model supplies — that is what capture
  // means. These three cannot be treated the same way:
  //   - `tags` are NEVER supplied by a prefill (`RecipePrefill.fields` has no `tags` member),
  //     so clearing them is a pure destroy with nothing to replace them and no undo.
  //   - `course`/`mealSlots` ARE supplied, but only when the model was confident. Overwriting
  //     the user's own ticks with "the model declined" is a loss, not an update.
  if (!prefill) {
    course.value = '';
    mealSlots.value = [];
    tags.value = [];
    return;
  }
  if (f?.course) course.value = f.course;
  if (f?.mealSlots?.length) mealSlots.value = sortSlots(f.mealSlots);
  // `tags` deliberately untouched on a merge — see above.
}

/**
 * Which lines the reader filled in itself. Derived from the PROP, never a `wasPrefilled`
 * ref — a ref would need clearing on close and would eventually be missed on one path.
 */
// applyPrefill is the one funnel both routes pass through, so read from what it recorded
// rather than from the prop only one of them sets.
const inferredIngredients = computed(() => localInferredIngredients.value);
const inferredSteps = computed(() => localInferredSteps.value);

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
      // Site 1 of 4 — the ONLY path that seeds from an existing recipe. See the refs above.
      course.value = r.course ?? '';
      mealSlots.value = sortSlots(r.mealSlots ?? []);
      tags.value = Array.isArray(r.tags) ? [...r.tags] : [];
    },
    // ONE reset path. A separate `watch(() => props.prefill)` would RACE this callback
    // (useFormModal fires it when `open` flips), and the resulting "sometimes the form
    // opens blank" bug is order-dependent and miserable to reproduce. applyPrefill(null)
    // IS the blank reset.
    onNew: () => applyPrefill(props.prefill),
  }
);

const canSave = computed(() => name.value.trim().length > 0);

const { courseLabel } = useRecipeCourseLabel();

/** A leading "not set" option, because clearing a course must be possible. */
const courseOptions = computed(() => [
  { value: '', label: t('recipes.field.courseNone') },
  ...COURSE_DEFS.map((c) => ({ value: c.id, label: `${c.emoji} ${courseLabel(c.id)}` })),
]);

const mealOptions = computed<ChipOption[]>(() =>
  MEAL_SLOTS.map((slot) => ({
    value: slot,
    label: t(SLOT_LABEL_KEYS[slot]),
    icon: SLOT_EMOJI[slot],
  }))
);

/**
 * Recomputed per (recipes, current tags) change — NOT per keystroke. `suggestTags` caps the
 * list because a family with 200 distinct tags would otherwise render 200 pills.
 */
// UNCAPPED on purpose: RecipeTagInput caps the visible row itself, and its autocomplete must
// search every previously-used tag — the one ranked 9th is exactly the tag a user cannot
// remember and most needs completed. Recomputed per (recipes, current tags) change, never per
// keystroke; the per-keystroke filtering is a cheap pure match over this list.
const tagSuggestions = computed(() => suggestTags(recipesStore.recipes, tags.value, Infinity));

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

/**
 * ADR-030 CONSENT GATE — the same one every other reader entry point runs.
 *
 * `useDocumentConsent`'s own header is explicit that this must run BEFORE a single document
 * leaves the device, and FamilyCookbookPage, TravelPlansPage and FamilyPlannerPage all await
 * it first. When this form took ownership of its own capture it inherited five mount points
 * (the cookbook, the recipe page, the meal-planner rail, the meal editor and the favourite
 * picker) and none of them gate anything — so a family that had actively DECLINED could pick
 * a scan of a recipe card from the rail and have it sent to the managed model with the modal
 * never shown. Owning the capture means owning the gate that goes with it.
 */
const { requestConsent } = useDocumentConsent();
// Held between the gate and the picker's file event: consent runs before the picker opens,
// but the extraction call that needs the token happens once a file is chosen.
let docGrant: ConsentGrant | null = null;

async function startLinkCapture(url: string): Promise<void> {
  const granted = await requestConsent();
  if (!granted) return;
  await capture.processUrl(url, granted);
}

async function startDocumentCapture(): Promise<void> {
  const granted = await requestConsent();
  if (!granted) return;
  docGrant = granted;
  aiDocPicker.value?.pick();
}

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
 * CLEARING A FIELD MUST CLEAR IT — WITHOUT CLOBBERING ANOTHER DEVICE'S EDIT.
 *
 * Two bugs, one line apart, and fixing the first naively caused the second.
 *
 * These optional fields were originally conditionally spread — omitted when blank. On create
 * that is equivalent, but on UPDATE the repository leaves absent keys untouched, so emptying
 * a field silently kept the old value: deleting a recipe's link was impossible.
 *
 * Always sending `undefined` fixes that and breaks something worse. `undefined` is the
 * repository's DELETE signal, so every save would then delete every blank field — including
 * ones the user never touched. Edit only the name on a recipe whose subtitle is empty, while
 * another family member adds a subtitle on their device, and your save wipes theirs. That is
 * precisely the failure class `docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md`
 * was written about, in a CRDT where the other device's edit is otherwise safe.
 *
 * `diffPayload` is the fix that already exists for it (ActivityModal and
 * ActivityViewEditModal both use it): it emits `undefined` ONLY for a field that had a value
 * and now does not, and omits everything untouched.
 */
function orUndefined(v: string): string | undefined {
  return v.trim() || undefined;
}

/**
 * The saved recipe as a payload, for diffing against. Captured from props rather than
 * rebuilt from the refs, so it reflects what is STORED, not what is on screen.
 */
function baselinePayload(r: Recipe) {
  return {
    name: r.name,
    subtitle: r.subtitle,
    prepTime: r.prepTime,
    cookTime: r.cookTime,
    servings: r.servings,
    sourceUrl: r.sourceUrl,
    ingredients: r.ingredients ?? [],
    steps: r.steps ?? [],
    notes: r.notes,
    // Site 3 of 4. `mealSlots` is canonicalised on BOTH sides because `diffPayload`'s array
    // equality is by INDEX — ['dinner','lunch'] and ['lunch','dinner'] would otherwise read as
    // a change and make a no-op save write.
    course: r.course,
    mealSlots: sortSlots(r.mealSlots ?? []),
    tags: Array.isArray(r.tags) ? r.tags : [],
  };
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
    // Site 4 of 4. `course` uses the existing orUndefined idiom (a cleared select is absent);
    // meals and tags are ALWAYS-SENT arrays like `ingredients`, because an empty array is a
    // meaningful value here — the user removed the last tag.
    course: course.value === '' ? undefined : course.value,
    mealSlots: sortSlots(mealSlots.value),
    tags: [...tags.value],
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
  // Send only what CHANGED. The baseline is read from the store rather than from
  // `props.recipe`, so it is correct on the eager-create path too — there the entity was
  // created by this very form and props.recipe is null, yet a second save must still diff
  // against what is actually stored. See `baselinePayload` for why this matters.
  update: (id, payload) => {
    const stored = recipesStore.recipes.find((r) => r.id === id);
    return recipesStore.updateRecipe(
      id,
      stored ? diffPayload(baselinePayload(stored), payload) : payload
    );
  },
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
    if (!isOpen) {
      // ABANDONING THE FORM MUST DROP WHAT THE CAPTURE IS HOLDING.
      //
      // This component is long-lived (:open, not v-if), so a capture's pending dish image
      // and source file outlive the modal closing — and handleSave calls attachAfterSave
      // unconditionally. Paste a link, change your mind, cancel; later open the form to edit
      // an unrelated recipe and save, and the abandoned photo is fetched and attached to
      // THAT recipe, with its card spinning for a photo it never asked for. Every failure
      // inside the attach is caught and logged at info, so it happens silently.
      //
      // FamilyCookbookPage carries exactly this guard for its own instance, with a comment
      // saying why. This instance was given the hazard without the fix.
      capture.discardPendingSource();
      // Cleared HERE, in the one place things are already cleared. No `props.recipe` watcher
      // branch is needed: `onNew` reseeds via `applyPrefill` on every open-for-new, and this
      // close path nulls it, so opening the form to EDIT finds it null by construction.
      dishImage.value = null;
    }
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
  // The footer sits OUTSIDE the slot the reading overlay covers, so Save stayed clickable
  // while a capture was in flight. Committing then closing means the extraction resolves
  // into a closed form, applyPrefill writes into nothing, and the next open wipes it —
  // ingredients, steps and times gone with no toast and nothing logged.
  if (capture.isProcessing.value) return;
  isSubmitting.value = true;
  try {
    const result = await eager.commit();
    if (!result) return; // store reported via wrapAsync; keep modal open for retry
    // Attach whatever OUR capture is holding, PLUS the dish candidates — which this
    // component owns on every route (see `dishImage`). Passing the object by value here is
    // load-bearing: `emit('close')` on the next line fires the watcher that nulls the ref,
    // and `attachAfterSave` is deliberately unawaited.
    void capture.attachAfterSave(result.id, dishImage.value);
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
  'focus:border-primary-500 focus:ring-primary-500 font-inter w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-relaxed text-[var(--color-text)] outline-none focus:ring-1 dark:border-line-strong dark:bg-surface-overlay dark:text-ink';
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
    :save-disabled="!canSave || capture.isProcessing.value"
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
        @submit="(url) => void startLinkCapture(url)"
        @document="void startDocumentCapture()"
      />

      <!-- Reading blocks the form: every field is about to be overwritten, so letting the
           user type meanwhile would only throw their work away. -->
      <div
        v-if="capture.isProcessing.value"
        class="dark:bg-surface-ground/85 absolute inset-0 z-10 grid place-items-center rounded-[var(--sq)] bg-white/85 backdrop-blur-sm"
      >
        <div class="flex flex-col items-center gap-3">
          <BeanieSpinner size="lg" :halo="true" />
          <p class="font-outfit text-secondary-500 dark:text-ink text-sm font-semibold">
            {{ t('ai.processing') }}
          </p>
        </div>
      </div>

      <!-- The consent modal is mounted globally in App.vue (#64) and stacks above this
           modal, so this form asks for consent without hosting the UI. -->
      <AiDocumentPicker
        ref="aiDocPicker"
        @file="(f) => docGrant && void capture.processFile(f, docGrant)"
      />

      <FormSection label-key="recipes.section.dish" emoji="🍽️" first>
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

        <!-- Where this came from, visible and editable — the same affordance activities have.
             It is filled in automatically by the reader, but a hand-typed recipe can carry a
             link too, and a captured one can be corrected. -->
        <!--
          ⚠️ HIDDEN WHILE THE READER STRIP IS UP, and that is not a nicety.

          `RecipeSourceStrip` is itself a `type="url"` input ("paste a link and I'll fill this
          in"). Moving this field up into "the dish" (#87 follow-up) put the two within one
          viewport of each other for the first time — before, they were a full scroll apart.
          Two URL boxes doing different things, and the labelled one is the more inviting: a
          user pastes their recipe URL into "Link", tabs away, and nothing happens, because
          capture only fires from the strip. The AI feature reads as broken on its own primary
          entry point.

          There is nothing to attribute until the form has content anyway, and the strip
          disappears the moment a name exists — typed or captured — at which point this field
          appears to carry the provenance. One URL box on screen at a time, always.
        -->
        <FormFieldGroup v-if="!showSourceStrip" :label="t('recipes.field.sourceUrl')" optional>
          <BaseInput
            v-model="sourceUrl"
            type="url"
            :placeholder="t('recipes.placeholder.sourceUrl')"
          />
        </FormFieldGroup>
      </FormSection>

      <FormSection label-key="recipes.section.method" emoji="🥄">
        <FormFieldGroup :label="t('recipes.field.ingredients')" optional>
          <textarea
            v-model="ingredientsText"
            rows="6"
            :class="LIST_TEXTAREA_CLASS"
            :placeholder="t('recipes.placeholder.ingredients').replace(/\\n/g, '\n')"
          />
          <!-- Heritage Orange, never Alert Red: this is a routine "worth a look", not an
             error. Same idiom as ActivityModal's low-confidence hint. -->
          <p
            v-if="inferredIngredients.length"
            class="font-outfit text-primary-500 dark:text-accent-lift mt-1.5 text-xs"
          >
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
          <p
            v-if="inferredSteps.length"
            class="font-outfit text-primary-500 dark:text-accent-lift mt-1.5 text-xs"
          >
            {{ t('recipeExtract.inferred.steps') }} {{ inferredSteps.join(', ') }}
          </p>
        </FormFieldGroup>
      </FormSection>

      <FormSection label-key="recipes.section.filing" emoji="🔖">
        <FormFieldGroup :label="t('recipes.field.course')" optional>
          <BaseSelect v-model="course" :options="courseOptions" />
        </FormFieldGroup>

        <FormFieldGroup :label="t('recipes.field.meals')" optional>
          <ChipToggleGroup
            v-model="mealSlots"
            :options="mealOptions"
            :aria-label="t('recipes.field.meals')"
          />
        </FormFieldGroup>

        <FormFieldGroup :label="t('recipes.field.tags')" optional>
          <RecipeTagInput v-model="tags" :suggestions="tagSuggestions" />
        </FormFieldGroup>
      </FormSection>

      <FormSection label-key="recipes.section.personal" emoji="✏️">
        <FormFieldGroup :label="t('recipes.field.notes')" optional>
          <textarea
            v-model="notes"
            rows="3"
            class="focus:border-primary-500 focus:ring-primary-500 font-caveat dark:border-line-strong dark:bg-surface-overlay dark:text-ink w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-lg leading-snug text-[var(--color-text)] outline-none focus:ring-1"
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
              class="hover:border-primary-500 hover:text-primary-500 dark:hover:text-accent-lift flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40"
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
      </FormSection>
    </div>
  </BeanieFormModal>
</template>
