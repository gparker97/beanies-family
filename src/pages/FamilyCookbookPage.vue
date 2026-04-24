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
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import PolaroidImage from '@/components/pod/shared/PolaroidImage.vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useRecipesStore } from '@/stores/recipesStore';
import { usePermissions } from '@/composables/usePermissions';
import { usePhotoStore } from '@/stores/photoStore';
import type { Recipe } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const recipesStore = useRecipesStore();
const photoStore = usePhotoStore();
const { canEditActivities } = usePermissions();

const modalOpen = ref(false);
const editing = ref<Recipe | null>(null);

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
  editing.value = null;
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
}
</script>

<template>
  <div class="space-y-6">
    <header
      class="relative mb-6 overflow-hidden rounded-[var(--sq)] border border-[rgb(230_126_34_/_15%)] bg-[#fbf3e3] px-5 py-6 sm:px-9 sm:py-8"
    >
      <span
        class="pointer-events-none absolute top-2.5 right-8 text-[150px] opacity-[0.09]"
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
            class="font-outfit text-secondary-500/60 mt-1 text-[11px] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('cookbook.stats.recipes') }}
          </span>
        </div>
        <div class="flex flex-col">
          <span class="text-primary-500 font-outfit text-2xl leading-none font-extrabold">
            {{ totalCookCount }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 mt-1 text-[11px] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('cookbook.stats.cooked') }}
          </span>
        </div>
        <div v-if="avgRating > 0" class="flex flex-col">
          <span class="text-primary-500 font-outfit text-2xl leading-none font-extrabold">
            ⭐ {{ avgRating }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 mt-1 text-[11px] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
          >
            {{ t('cookbook.stats.avgRating') }}
          </span>
        </div>

        <button
          v-if="canEditActivities"
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)] sm:ml-auto sm:w-auto"
          @click="openAdd"
        >
          <span aria-hidden="true">＋</span>
          <span>{{ t('cookbook.addRecipe') }}</span>
        </button>
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
          :caption="thumbFor(r) ? undefined : t('cookbook.card.noPhoto')"
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

    <RecipeFormModal :open="modalOpen" :recipe="editing" @close="closeModal" />
  </div>
</template>
