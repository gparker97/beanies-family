<script setup lang="ts">
/**
 * The whole "read the source again" affordance, in one component (#93).
 *
 * Button + composable + modal. `RecipeDetailPage` renders ONE line and gains no script state:
 * it is already 481 lines hosting three modals, and the precedent for this is
 * `RecipeFormModal`, which took ownership of its own capture for exactly this reason.
 * Nothing forces this upward — the consent modal is a singleton mounted in `App.vue`, and
 * `BaseModal` teleports to `body`.
 *
 * ⚠️ THE CALLER MUST PASS `:key="recipe.id"`. `recipeId` on the detail page is a computed off
 * `route.params` and vue-router REUSES the page instance across param changes — which is why
 * that page needs its own present-then-absent delete watcher. Unkeyed, an open diff or an
 * in-flight fetch for recipe A would survive navigation to recipe B and could be applied to
 * the wrong recipe. The key removes that class with no guard code.
 */
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import RecipeRefetchModal from './RecipeRefetchModal.vue';
import { useRecipeRefetch } from '@/composables/useRecipeRefetch';
import { useTranslation } from '@/composables/useTranslation';
import type { Recipe } from '@/types/models';

const props = defineProps<{ recipe: Recipe }>();

const { t } = useTranslation();
const { start, isProcessing, diff, isOpen, take, dismiss } = useRecipeRefetch();
</script>

<template>
  <button
    type="button"
    class="font-outfit text-secondary-500 dark:bg-surface-raised/80 dark:text-ink dark:hover:bg-surface-hover inline-flex items-center gap-1.5 rounded-2xl bg-white/80 px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-white disabled:opacity-60"
    :disabled="isProcessing"
    data-testid="recipe-refetch"
    @click="start(props.recipe)"
  >
    <BeanieSpinner v-if="isProcessing" size="xs" />
    <BeanieIcon v-else name="refresh" size="xs" />
    <span>{{ t('recipes.refetch.action') }}</span>
  </button>

  <RecipeRefetchModal v-if="diff" :open="isOpen" :diff="diff" @take="take" @close="dismiss" />
</template>
