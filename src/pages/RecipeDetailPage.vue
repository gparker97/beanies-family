<script setup lang="ts">
/**
 * Recipe detail page at `/pod/cookbook/:recipeId`.
 *
 *   [ hero polaroid ] [ name + meta chips + Edit/+ cook actions ]
 *   [ ingredients list ] [ preparation steps ]
 *   [ family notes card ]
 *   [ cook log stats ]
 *   [ cook log entries ]
 *
 * Edit flow reuses RecipeFormModal (edit mode). "I cooked this today"
 * opens CookLogFormModal for a new entry; clicking an existing entry
 * edits it.
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import PolaroidImage from '@/components/pod/shared/PolaroidImage.vue';
import StatStrip from '@/components/pod/shared/StatStrip.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import CookLogFormModal from '@/components/pod/CookLogFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePhotoStore } from '@/stores/photoStore';
import { useRecipePhotoPending } from '@/composables/useRecipePhotoPending';
import { usePermissions } from '@/composables/usePermissions';
import type { CookLogEntry } from '@/types/models';
import { getUrlDomain, safeExternalHref } from '@/utils/url';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();
const photoStore = usePhotoStore();
const { isPending } = useRecipePhotoPending();
const { canEditActivities } = usePermissions();

const recipeId = computed(() => (route.params.recipeId as string) ?? '');
const recipe = computed(() => recipesStore.recipes.find((r) => r.id === recipeId.value));

// Screened once here rather than twice in the template. Rejected values render no
// anchor at all; the URL is not shown as plain text because, unlike a link the user
// typed, a captured sourceUrl they cannot edit is noise rather than something to fix.
const recipeSourceHref = computed(() => safeExternalHref(recipe.value?.sourceUrl));

const cookLogs = computed(() =>
  recipe.value ? recipesStore.cookLogsByRecipe(recipe.value.id).value : []
);
const stats = computed(() =>
  recipe.value
    ? recipesStore.cookStatsForRecipe(recipe.value.id).value
    : { count: 0, avgRating: 0, lastCookedOn: null }
);

const editRecipeOpen = ref(false);
const cookLogOpen = ref(false);
const editingEntry = ref<CookLogEntry | null>(null);

// Photo lightbox — opens when the user taps the polaroid hero. Read-only:
// edits flow through the recipe edit drawer, not the lightbox itself, so
// download is the only useful action and we let the standard PhotoViewer
// chrome handle that.
const lightboxOpen = ref(false);
const lightboxPhotoIds = computed<string[]>(() => recipe.value?.photoIds ?? []);
function openLightbox(): void {
  if (lightboxPhotoIds.value.length === 0) return;
  lightboxOpen.value = true;
}

function openAddCookLog(): void {
  editingEntry.value = null;
  cookLogOpen.value = true;
}

// Quick-add FAB — `add-cooklog` on a recipe detail route pre-fills the
// recipe (via route.params.recipeId) and opens the log modal directly.
useQuickAddIntent((action) => {
  if (action === 'add-cooklog') openAddCookLog();
});

function openEditCookLog(e: CookLogEntry): void {
  editingEntry.value = e;
  cookLogOpen.value = true;
}

// Hero photo — public Drive URL (ADR-021). Sync, no fetch.
const heroUrl = computed<string | null>(() => {
  const pid = recipe.value?.photoIds?.[0];
  if (!pid) return null;
  return photoStore.getPublicUrl(pid, 'full');
});

const statStrip = computed(() => {
  if (!recipe.value) return [];
  return [
    {
      value: stats.value.count,
      label: t('cookLog.stats.times'),
      emoji: '🍳',
      accent: 'primary' as const,
    },
    {
      value: stats.value.count > 0 ? `${Math.round(stats.value.avgRating * 10) / 10} ⭐` : '—',
      label: t('cookLog.stats.avg'),
      accent: 'terracotta' as const,
    },
    {
      value: daysSinceLabel(stats.value.lastCookedOn),
      label: t('cookLog.stats.lastCooked'),
      accent: 'silk' as const,
    },
  ];
});

function daysSinceLabel(iso: string | null): string {
  if (!iso) return t('cookLog.stats.never');
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t('cookLog.stats.never');
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t('cookLog.stats.today');
  if (days === 1) return t('cookLog.stats.yesterday');
  return t('cookLog.stats.daysSince').replace('{n}', String(days));
}

function memberName(id?: string): string {
  if (!id) return t('cookLog.byline.someone');
  return familyStore.members.find((m) => m.id === id)?.name ?? t('cookLog.byline.someone');
}

function onRecipeDeleted(): void {
  router.push('/pod/cookbook');
}
</script>

<template>
  <div class="space-y-6">
    <template v-if="recipe">
      <button
        type="button"
        class="font-outfit text-secondary-500/60 hover:text-primary-500 mb-3 flex items-center gap-1 text-xs font-semibold transition-colors"
        @click="router.push('/pod/cookbook')"
      >
        <BeanieIcon name="chevron-left" size="xs" />
        <span>{{ t('recipes.detail.backToCookbook') }}</span>
      </button>

      <!-- Hero -->
      <section
        class="mb-6 grid gap-5 rounded-[var(--sq)] border border-[rgb(230_126_34_/_12%)] bg-[#fbf3e3] p-4 sm:gap-6 sm:p-6 lg:grid-cols-[1.1fr_1fr]"
      >
        <!--
          Hero polaroid is clickable when a photo exists — opens the
          shared PhotoViewer lightbox. Wrapped in a button (vs adding a
          @click prop to PolaroidImage) so the polaroid component stays
          purely presentational; each call site decides whether the
          surface is interactive. The cookbook landing page deliberately
          keeps PolaroidImage non-clickable since its tile-tap navigates
          to this detail page instead. Subtle scale-up on hover signals
          the affordance without disturbing the polaroid's restful
          geometry.
        -->
        <button
          v-if="heroUrl"
          type="button"
          class="group block rounded-[var(--sq)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fbf3e3]"
          :aria-label="t('recipes.detail.openPhoto')"
          @click="openLightbox"
        >
          <PolaroidImage
            :src="heroUrl"
            :caption="recipe.subtitle ?? recipe.name"
            aspect-ratio="4 / 3"
            class="cursor-zoom-in transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-[0.99]"
          />
        </button>
        <!-- The photo is fetched AFTER the recipe saves, so for a few seconds a freshly
             captured recipe has none. Saying so in the polaroid itself is the honest place:
             it is exactly where the picture is about to appear. -->
        <PolaroidImage
          v-else
          :src="null"
          :caption="
            isPending(recipe.id) ? t('recipeExtract.attaching') : t('cookbook.card.noPhoto')
          "
          aspect-ratio="4 / 3"
        />
        <div class="flex flex-col">
          <h1
            class="font-outfit text-secondary-500 text-2xl leading-tight font-extrabold break-words sm:text-3xl"
          >
            {{ recipe.name }}
          </h1>
          <p v-if="recipe.subtitle" class="font-caveat mt-1 text-xl text-[#E67E22]">
            {{ recipe.subtitle }}
          </p>
          <div class="font-inter text-secondary-500/70 mt-3 flex flex-wrap gap-3 text-xs">
            <span v-if="recipe.prepTime">
              🕐
              <strong class="font-outfit text-secondary-500 font-semibold">{{
                recipe.prepTime
              }}</strong>
            </span>
            <span v-if="recipe.cookTime">
              🔥
              <strong class="font-outfit text-secondary-500 font-semibold">{{
                recipe.cookTime
              }}</strong>
            </span>
            <span v-if="recipe.servings">
              🍽️
              <strong class="font-outfit text-secondary-500 font-semibold">{{
                recipe.servings
              }}</strong>
            </span>
            <span v-if="recipe.ingredients?.length">
              🌿
              <strong class="font-outfit text-secondary-500 font-semibold">
                {{ recipe.ingredients.length }} {{ t('cookbook.card.ingredients') }}
              </strong>
            </span>
          </div>

          <!-- Provenance on its own line. It reads as a destination rather than a statistic,
               and among the times and servings it was easy to miss entirely. Quiet, but
               unmissable once you look. safeExternalHref, never getFaviconUrl: a favicon
               call would fire a third-party request on every recipe view, which is exactly
               what fetch-and-store exists to avoid. -->
          <a
            v-if="recipeSourceHref"
            :href="recipeSourceHref"
            target="_blank"
            rel="noopener noreferrer"
            class="font-inter text-secondary-500/70 hover:text-primary-500 mt-2 inline-flex w-fit items-center gap-1.5 text-xs transition-colors"
          >
            <span aria-hidden="true">🔗</span>
            <span>{{ t('recipes.detail.source') }}</span>
            <strong class="font-outfit text-primary-500 font-semibold underline underline-offset-2">
              {{ getUrlDomain(recipe.sourceUrl ?? '') }}
            </strong>
          </a>

          <div v-if="canEditActivities" class="mt-auto flex flex-wrap gap-2 pt-4">
            <button
              type="button"
              class="font-outfit text-secondary-500 inline-flex items-center gap-1.5 rounded-2xl bg-white/80 px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-white dark:bg-slate-800/80 dark:text-gray-100"
              @click="editRecipeOpen = true"
            >
              <BeanieIcon name="edit" size="xs" />
              <span>{{ t('bean.hero.edit') }}</span>
            </button>
            <button
              type="button"
              class="font-outfit from-primary-500 to-terracotta-400 inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
              @click="openAddCookLog"
            >
              🍳 <span>{{ t('recipes.detail.iCooked') }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Ingredients + Steps -->
      <section class="mb-6 grid gap-5 md:grid-cols-[0.85fr_1.15fr]">
        <div class="rounded-[20px] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800">
          <h3 class="font-outfit text-secondary-500 mb-3 text-sm font-bold dark:text-gray-100">
            🌿 {{ t('recipes.detail.ingredients') }}
          </h3>
          <ul v-if="recipe.ingredients?.length" class="space-y-1">
            <li
              v-for="(ing, i) in recipe.ingredients"
              :key="i"
              class="font-inter text-secondary-500/80 text-sm leading-relaxed dark:text-gray-300"
            >
              · {{ ing }}
            </li>
          </ul>
          <p v-else class="font-inter text-secondary-500/50 text-sm italic">
            {{ t('recipes.detail.noIngredients') }}
          </p>
        </div>

        <div class="rounded-[20px] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800">
          <h3 class="font-outfit text-secondary-500 mb-3 text-sm font-bold dark:text-gray-100">
            📋 {{ t('recipes.detail.steps') }}
          </h3>
          <ol v-if="recipe.steps?.length" class="space-y-2">
            <li
              v-for="(step, i) in recipe.steps"
              :key="i"
              class="font-inter text-secondary-500/80 flex gap-3 text-sm leading-relaxed dark:text-gray-300"
            >
              <span class="font-outfit text-primary-500 flex-shrink-0 text-xs leading-5 font-bold"
                >{{ i + 1 }}.</span
              >
              <span>{{ step }}</span>
            </li>
          </ol>
          <p v-else class="font-inter text-secondary-500/50 text-sm italic">
            {{ t('recipes.detail.noSteps') }}
          </p>
        </div>
      </section>

      <!-- Notes -->
      <section
        v-if="recipe.notes"
        class="font-caveat text-secondary-500 mb-6 rounded-[20px] bg-[#fff7c8] p-6 text-lg leading-snug"
        style="box-shadow: var(--card-shadow); transform: rotate(-0.4deg)"
      >
        📝 {{ recipe.notes }}
      </section>

      <!-- Cook Log -->
      <section class="mb-6">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-outfit text-secondary-500 text-lg font-bold dark:text-gray-100">
            🍳 {{ t('recipes.detail.cookLog') }}
          </h2>
        </div>
        <StatStrip v-if="cookLogs.length" :stats="statStrip" class="mb-4" />
        <div v-if="cookLogs.length" class="grid gap-3 md:grid-cols-2">
          <button
            v-for="e in cookLogs"
            :key="e.id"
            type="button"
            class="flex flex-col items-start gap-1 rounded-[var(--sq)] bg-white p-4 text-left shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
            @click="openEditCookLog(e)"
          >
            <div class="flex w-full items-center justify-between">
              <div class="flex items-center gap-1">
                <span v-for="n in 5" :key="n" class="text-sm">
                  <span :class="e.rating >= n ? '' : 'opacity-30 grayscale'">⭐</span>
                </span>
              </div>
              <span class="font-outfit text-secondary-500/60 text-[0.6875rem] font-semibold">
                {{ e.cookedOn }}
              </span>
            </div>
            <p
              v-if="e.wentWell"
              class="font-inter text-secondary-500/80 text-sm dark:text-gray-300"
            >
              ✅ {{ e.wentWell }}
            </p>
            <p
              v-if="e.toImprove"
              class="font-inter text-secondary-500/60 text-sm italic dark:text-gray-400"
            >
              ✏️ {{ e.toImprove }}
            </p>
            <span class="font-inter text-secondary-500/50 mt-1 text-[0.6875rem]">
              {{ t('cookLog.byline.cookedBy') }} {{ memberName(e.cookedBy) }}
            </span>
          </button>
        </div>
        <div
          v-else
          class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
        >
          <EmptyState
            emoji="🍳"
            :message="t('cookLog.empty')"
            :action-label="canEditActivities ? t('cookLog.emptyCTA') : ''"
            @action="openAddCookLog"
          />
        </div>
      </section>

      <RecipeFormModal
        :open="editRecipeOpen"
        :recipe="recipe"
        @close="editRecipeOpen = false"
        @deleted="onRecipeDeleted"
      />
      <CookLogFormModal
        :open="cookLogOpen"
        :recipe-id="recipe.id"
        :entry="editingEntry"
        @close="
          cookLogOpen = false;
          editingEntry = null;
        "
      />
      <!--
        Photo lightbox — read-only. Edits route through the recipe edit
        drawer, not the lightbox, so the standard read-only chrome
        (close + chevrons + dot pips) is what we want.
      -->
      <PhotoViewer
        v-if="lightboxPhotoIds.length"
        :open="lightboxOpen"
        :photo-ids="lightboxPhotoIds"
        read-only
        @close="lightboxOpen = false"
      />
    </template>
    <div
      v-else
      class="flex flex-col items-center justify-center gap-3 rounded-[var(--sq)] bg-white/60 py-16 text-center dark:bg-slate-800/60"
    >
      <span class="text-5xl" aria-hidden="true">🍝</span>
      <h1 class="font-outfit text-secondary-500 text-xl font-bold dark:text-gray-100">
        {{ t('recipes.detail.notFound.title') }}
      </h1>
      <p class="text-secondary-500/60 text-sm">{{ t('recipes.detail.notFound.body') }}</p>
      <button
        type="button"
        class="font-outfit text-primary-500 text-sm font-semibold hover:underline"
        @click="router.push('/pod/cookbook')"
      >
        {{ t('recipes.detail.backToCookbook') }}
      </button>
    </div>
  </div>
</template>
