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
import { useRecipesStore } from '@/stores/recipesStore';
import { usePermissions } from '@/composables/usePermissions';
import { usePhotoStore } from '@/stores/photoStore';
import type { Recipe, UUID } from '@/types/models';

const router = useRouter();
const { t } = useTranslation();
const recipesStore = useRecipesStore();
const photoStore = usePhotoStore();
const { canManagePod } = usePermissions();

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

// Per-recipe hero thumbnail. Returns null while resolving or when the
// recipe has no photos; PolaroidImage renders its placeholder in that
// case. Cached per recipe id so repeat card renders don't re-fetch.
const thumbCache = ref<Record<UUID, string | null>>({});

async function getRecipeThumb(recipe: Recipe): Promise<void> {
  if (!recipe.photoIds?.length) return;
  const first = recipe.photoIds[0]!;
  if (thumbCache.value[first] !== undefined) return;
  thumbCache.value = { ...thumbCache.value, [first]: null };
  try {
    const url = await photoStore.getBlobUrl(first);
    thumbCache.value = { ...thumbCache.value, [first]: url };
  } catch (e) {
    console.warn('[cookbookPage] recipe thumb resolve failed', e);
  }
}

function thumbFor(recipe: Recipe): string | null {
  const id = recipe.photoIds?.[0];
  if (!id) return null;
  if (thumbCache.value[id] === undefined) void getRecipeThumb(recipe);
  return thumbCache.value[id] ?? null;
}

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openRecipe(r: Recipe): void {
  router.push(`/pod/cookbook/${r.id}`);
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <header
      class="relative mb-6 overflow-hidden rounded-[var(--sq)] border border-[rgb(230_126_34_/_15%)] bg-[#fbf3e3] px-9 py-8"
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
        class="font-outfit text-secondary-500 text-3xl leading-none font-extrabold dark:text-gray-100"
      >
        {{ t('cookbook.title') }}
      </h1>
      <p class="font-caveat mt-1 text-xl text-[#E67E22]">{{ t('cookbook.subtitle') }}</p>

      <div class="relative mt-4 flex flex-wrap items-end gap-6">
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
          v-if="canManagePod"
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 ml-auto inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
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
        v-if="canManagePod"
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
        :action-label="canManagePod ? t('cookbook.emptyCTA') : ''"
        @action="openAdd"
      />
    </div>

    <RecipeFormModal :open="modalOpen" :recipe="editing" @close="closeModal" />
  </main>
</template>
