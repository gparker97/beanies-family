<script setup lang="ts">
/**
 * Family Cookbook — the secret-recipes page at `/pod/cookbook`. Hero
 * banner with stat strip, "Add a recipe" primary action, then a grid
 * of recipe cards. Cards click through to /pod/cookbook/:recipeId.
 *
 * Photos are optional per recipe — the card falls through to a
 * `PolaroidImage` placeholder illustration when no photo is set,
 * matching the mockup's kraft-paper style.
 */
import AiProcessingOverlay from '@/components/ai/AiProcessingOverlay.vue';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import PolaroidImage from '@/components/pod/shared/PolaroidImage.vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useRecipePhotoPending } from '@/composables/useRecipePhotoPending';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import AiDocumentPicker from '@/components/ai/AiDocumentPicker.vue';
import RecipeLinkModal from '@/components/pod/RecipeLinkModal.vue';
import MagicReaderPill from '@/components/ai/MagicReaderPill.vue';
import { useDocumentConsent, type ConsentGrant } from '@/composables/useDocumentConsent';
import { useMagicReader, useMagicReaderConsumer } from '@/composables/useMagicReader';
import { useRecipeCapture } from '@/composables/useRecipeCapture';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useRecipesStore } from '@/stores/recipesStore';
import { usePermissions } from '@/composables/usePermissions';
import { usePhotoStore } from '@/stores/photoStore';
import type { Recipe } from '@/types/models';
import type { RecipePrefill } from '@/utils/recipeExtractionToRecipe';

const router = useRouter();
const { t } = useTranslation();
const recipesStore = useRecipesStore();
const photoStore = usePhotoStore();
const { canEditActivities } = usePermissions();

const modalOpen = ref(false);
const editing = ref<Recipe | null>(null);

// ── Magic-beans recipe reader (#72) ──────────────────────────────────────────
// Orchestration lives in useRecipeCapture, NOT here. This page only: opens the
// consent gate, opens the picker, opens the form with the prefill, and forwards
// the saved id back for the source attach.
const { canReadRecipe } = useMagicReader();
// The consent modal is mounted ONCE in App.vue (#64); this page only asks. The grant is
// held between the gate and the picker's file event — consent runs before the picker opens.
const { requestConsent } = useDocumentConsent();
let docGrant: ConsentGrant | null = null;
const aiDocPicker = ref<InstanceType<typeof AiDocumentPicker> | null>(null);
const prefill = ref<RecipePrefill | null>(null);
const linkModalOpen = ref(false);
const { isPending } = useRecipePhotoPending();

const capture = useRecipeCapture({
  onRecipeReady: (ready) => {
    prefill.value = ready.prefill;
    editing.value = null;
    modalOpen.value = true;
  },
});

function handlePastedLink(url: string): void {
  linkModalOpen.value = false;
  if (docGrant) void capture.processUrl(url, docGrant);
}

/** Secondary sources, chosen from inside the link modal rather than a separate chooser. */
function handleUseCamera(): void {
  linkModalOpen.value = false;
  aiDocPicker.value?.pickCamera();
}
function handleUseFile(): void {
  linkModalOpen.value = false;
  aiDocPicker.value?.pickFile();
}

/**
 * 🍳 entry point. Consent runs BEFORE anything opens; a decline is a silent no-op.
 *
 * Opens the LINK modal directly. A link is the everyday source, so it gets the field
 * focused and ready to paste; camera and file live inside that modal, one tap away.
 */
async function handleAddFromDocument(): Promise<void> {
  const granted = await requestConsent();
  if (!granted) return;
  docGrant = granted;
  linkModalOpen.value = true;
}

// Cross-surface dispatch: the global FAB card sets `pendingMagic` and routes here;
// without this the chip would navigate to the cookbook and then silently do nothing.
// A share arrives already extracted (#64) and is DELIVERED rather than re-read.
//
// It MUST be delivered into THIS `useRecipeCapture()` instance: `deliverRecipe` sets the
// pending source that `attachAfterSave` later consumes, and that state is composable-local.
// A fresh instance would save the recipe with no photo attached — silently.
useMagicReaderConsumer(
  'recipe',
  (payload) => {
    if (payload) capture.deliverRecipe(payload.source, payload.env);
    else void handleAddFromDocument();
  },
  canReadRecipe
);

const recipes = computed(() =>
  [...recipesStore.recipes].sort((a, b) => a.name.localeCompare(b.name))
);

const totalCookCount = computed(() => recipesStore.cookLogs.length);

const avgRating = computed(() => {
  if (recipesStore.cookLogs.length === 0) return 0;
  const sum = recipesStore.cookLogs.reduce((acc, c) => acc + c.rating, 0);
  return Math.round((sum / recipesStore.cookLogs.length) * 10) / 10;
});

// Per-recipe hero thumbnail — resolved synchronously via
// `photoStore.getPublicUrl` (ADR-021 public-link rendering). Returns
// null when the recipe has no photos or the first photo is tombstoned
// / unresolved; PolaroidImage renders its placeholder in that case.
function thumbFor(recipe: Recipe): string | null {
  const id = recipe.photoIds?.[0];
  if (!id) return null;
  return photoStore.getPublicUrl(id, 'thumb');
}

function openAdd(): void {
  // The overlay blocks the button, but the `add-recipe` quick-add intent can fire
  // programmatically. Opening the blank form here would strand the in-flight extraction:
  // useFormModal runs onNew on the open TRANSITION only, so the prefill would never apply
  // and the held source would attach to whatever the user typed instead.
  if (capture.isProcessing.value) return;
  // `isProcessing` is only true once a file is actually being read — it is FALSE for the
  // whole window between tapping 🍳 and choosing a file. Opening the blank form in that
  // window and then letting the extraction finish would leave the prefill undelivered
  // (useFormModal's watch does not fire on true→true) AND attach the extracted document to
  // whatever the user typed instead. Dropping the held source is what makes that safe.
  capture.discardPendingSource();
  editing.value = null;
  prefill.value = null;
  modalOpen.value = true;
}

// Quick-add FAB handlers.
//
// - `add-recipe` opens the RecipeFormModal directly.
// - `add-cooklog` with a `recipeId` forwards to the recipe detail page
//   where RecipeDetailPage's existing handler opens the CookLogFormModal.
//   The sheet's picker guarantees recipeId is always present when this
//   action routes through the cookbook index.
useQuickAddIntent(async (action, { recipeId }) => {
  if (action === 'add-recipe') {
    openAdd();
    return;
  }
  if (action === 'add-cooklog' && recipeId) {
    await router.push({ path: `/pod/cookbook/${recipeId}`, query: { action } });
  }
});

function openRecipe(r: Recipe): void {
  router.push(`/pod/cookbook/${r.id}`);
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
  // Abandoning the form drops the held source, so it can never attach to a later recipe.
  prefill.value = null;
  capture.discardPendingSource();
}

/** Save completed — hand the id back so the source document can be attached. */
async function handleSaved(id: string): Promise<void> {
  prefill.value = null;
  await capture.attachAfterSave(id);
}
</script>

<template>
  <div class="space-y-6">
    <header
      class="relative mb-6 overflow-hidden rounded-[var(--sq)] border border-[rgb(230_126_34_/_15%)] bg-[#fbf3e3] px-5 py-6 sm:px-9 sm:py-8"
    >
      <span
        class="pointer-events-none absolute top-2.5 right-8 text-[9.375rem] opacity-[0.09]"
        style="transform: rotate(-8deg)"
        aria-hidden="true"
      >
        🍳
      </span>
      <button
        type="button"
        class="font-outfit text-secondary-500/60 hover:text-primary-500 mb-1 flex items-center gap-1 text-xs font-semibold transition-colors"
        @click="router.push('/pod')"
      >
        <BeanieIcon name="chevron-left" size="xs" />
        <span>{{ t('bean.backToPod') }}</span>
      </button>
      <h1
        class="font-outfit text-secondary-500 text-2xl leading-tight font-extrabold break-words sm:text-3xl sm:leading-none dark:text-gray-100"
      >
        {{ t('cookbook.title') }}
      </h1>
      <p class="font-caveat mt-1 text-xl text-[#E67E22]">{{ t('cookbook.subtitle') }}</p>

      <div class="relative mt-4 flex flex-wrap items-end gap-4 sm:gap-6">
        <div class="flex flex-col">
          <span class="text-primary-500 font-outfit text-2xl leading-none font-extrabold">
            {{ recipes.length }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('cookbook.stats.recipes') }}
          </span>
        </div>
        <div class="flex flex-col">
          <span class="text-primary-500 font-outfit text-2xl leading-none font-extrabold">
            {{ totalCookCount }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('cookbook.stats.cooked') }}
          </span>
        </div>
        <div v-if="avgRating > 0" class="flex flex-col">
          <span class="text-primary-500 font-outfit text-2xl leading-none font-extrabold">
            ⭐ {{ avgRating }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('cookbook.stats.avgRating') }}
          </span>
        </div>

        <div class="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
          <MagicReaderPill
            v-if="canReadRecipe"
            :label="t('recipeExtract.reader.label')"
            :aria-label="t('recipeExtract.reader.aria')"
            @click="handleAddFromDocument"
          />
          <AddEntityButton
            v-if="canEditActivities"
            :label="t('cookbook.addRecipe')"
            class="w-full sm:w-auto"
            @click="openAdd"
          />
        </div>
      </div>
    </header>

    <div
      v-if="recipes.length"
      class="grid gap-5"
      style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))"
    >
      <article
        v-for="r in recipes"
        :key="r.id"
        class="group cursor-pointer overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)] transition-all hover:-translate-y-1 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
        @click="openRecipe(r)"
      >
        <PolaroidImage
          :src="thumbFor(r)"
          :loading="!thumbFor(r) && isPending(r.id)"
          :caption="
            thumbFor(r)
              ? undefined
              : isPending(r.id)
                ? t('recipeExtract.attaching')
                : t('cookbook.card.noPhoto')
          "
          aspect-ratio="16 / 10"
        />
        <div class="p-4">
          <h3 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
            {{ r.name }}
          </h3>
          <p v-if="r.subtitle" class="font-inter text-secondary-500/60 mt-1 text-xs">
            {{ r.subtitle }}
          </p>
          <div class="font-inter text-secondary-500/60 mt-3 flex flex-wrap gap-4 text-xs">
            <span v-if="r.cookTime"
              >🔥
              <strong class="font-outfit text-secondary-500 font-semibold">{{
                r.cookTime
              }}</strong></span
            >
            <span v-if="r.prepTime"
              >🕐
              <strong class="text-secondary-500 font-outfit font-semibold">{{
                r.prepTime
              }}</strong></span
            >
            <span v-if="r.servings"
              >🍽️
              <strong class="text-secondary-500 font-outfit font-semibold">{{
                r.servings
              }}</strong></span
            >
            <span v-if="r.ingredients?.length">
              🌿
              <strong class="text-secondary-500 font-outfit font-semibold">
                {{ r.ingredients.length }} {{ t('cookbook.card.ingredients') }}
              </strong>
            </span>
          </div>
        </div>
      </article>

      <AddTile
        v-if="canEditActivities"
        :label="t('cookbook.addRecipe')"
        min-height="16rem"
        @click="openAdd"
      />
    </div>
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="🍝"
        :message="t('cookbook.empty')"
        :action-label="canEditActivities ? t('cookbook.emptyCTA') : ''"
        @action="openAdd"
      />
    </div>

    <RecipeFormModal
      :open="modalOpen"
      :recipe="editing"
      :prefill="prefill"
      @close="closeModal"
      @saved="handleSaved"
    />

    <AiProcessingOverlay :open="capture.isProcessing.value" />

    <AiDocumentPicker
      ref="aiDocPicker"
      @file="(f) => docGrant && void capture.processFile(f, docGrant)"
    />
    <RecipeLinkModal
      :open="linkModalOpen"
      @close="linkModalOpen = false"
      @submit="handlePastedLink"
      @camera="handleUseCamera"
      @file="handleUseFile"
    />
  </div>
</template>
