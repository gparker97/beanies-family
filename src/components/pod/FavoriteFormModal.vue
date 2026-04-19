<script setup lang="ts">
/**
 * Add/edit a FavoriteItem for a specific bean. Drawer-style
 * BeanieFormModal, save/cancel, delete visible in edit mode.
 *
 * The food category is a special case per the mockup: instead of just
 * a "Name" field, food favorites get a dedicated orange-tinted
 * "Food details" block with a recipe dropdown (linking to the Family
 * Cookbook) OR a free-text "Type it in" input below an "or" divider.
 * Non-food categories keep the plain Name input.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { confirm } from '@/composables/useConfirm';
import type { FavoriteCategory, FavoriteItem, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  memberId: UUID;
  favorite?: FavoriteItem | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const favoritesStore = useFavoritesStore();
const recipesStore = useRecipesStore();

const name = ref('');
const description = ref('');
const category = ref<FavoriteCategory>('food');
const recipeId = ref<string>('');

// Sentinel — picking this option in the dropdown opens the
// RecipeFormModal layered on top so the user can create a new recipe
// without losing the in-progress favorite. Leading-underscore + double-
// underscore pattern keeps it from colliding with a real UUID.
const ADD_RECIPE_SENTINEL = '__add_recipe__';

const recipeOptions = computed(() => [
  { value: '', label: t('favorites.recipe.none') },
  ...recipesStore.recipes
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ value: r.id, label: `🥘 ${r.name}` })),
  { value: ADD_RECIPE_SENTINEL, label: t('favorites.recipe.addNew') },
]);

const showRecipeModal = ref(false);

// Intercept the sentinel before it sticks on recipeId — we don't want
// the favorite's recipeId ref to ever hold "__add_recipe__". Open the
// RecipeFormModal and reset recipeId to '' so the dropdown clears.
watch(recipeId, (id, prev) => {
  if (id === ADD_RECIPE_SENTINEL) {
    recipeId.value = prev ?? '';
    showRecipeModal.value = true;
  }
});

function onRecipeSaved(id: UUID): void {
  // RecipeFormModal emits `saved` before `close`; grab the id so the
  // newly-created recipe is immediately selected in the dropdown.
  recipeId.value = id;
  showRecipeModal.value = false;
}

const categoryOptions = computed(() => [
  { value: 'food', label: t('favorites.category.food'), icon: '\u{1F35C}' },
  { value: 'place', label: t('favorites.category.place'), icon: '\u{1F4CD}' },
  { value: 'book', label: t('favorites.category.book'), icon: '\u{1F4DA}' },
  { value: 'song', label: t('favorites.category.song'), icon: '\u{1F3B5}' },
  { value: 'toy', label: t('favorites.category.toy'), icon: '\u{1F9F8}' },
  { value: 'other', label: t('favorites.category.other'), icon: '\u2728' },
]);

const { isEditing, isSubmitting } = useFormModal(
  () => props.favorite,
  () => props.open,
  {
    onEdit: (f) => {
      name.value = f.name;
      description.value = f.description ?? '';
      category.value = f.category;
      recipeId.value = f.recipeId ?? '';
    },
    onNew: () => {
      name.value = '';
      description.value = '';
      category.value = 'food';
      recipeId.value = '';
    },
  }
);

// Selecting a recipe wipes the free-text name — the recipe IS the name
// (we auto-populate on save). Clearing the recipe lets the user type
// freely again. Without this watch, the two inputs could both carry
// values and the save path would pick the wrong one.
watch(recipeId, (id) => {
  if (id) name.value = '';
});
watch(name, (v) => {
  if (v.trim() && recipeId.value) recipeId.value = '';
});

// Food favorites: either a recipe is picked OR a name is typed.
// Non-food: name is always required.
const canSave = computed(() => {
  if (category.value === 'food') {
    return recipeId.value.trim().length > 0 || name.value.trim().length > 0;
  }
  return name.value.trim().length > 0;
});

const title = computed(() =>
  isEditing.value ? t('favorites.editTitle') : t('favorites.addTitle')
);

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    // For food-with-recipe: auto-populate name from the recipe so the
    // favorite card still has something to display if the recipe is
    // later unlinked / deleted. Mirrors the mockup's behavior where
    // the selected recipe becomes the favorite's identity.
    let resolvedName = name.value.trim();
    if (category.value === 'food' && recipeId.value && !resolvedName) {
      const recipe = recipesStore.recipes.find((r) => r.id === recipeId.value);
      resolvedName = recipe?.name ?? '';
    }

    const payload = {
      memberId: props.memberId,
      category: category.value,
      name: resolvedName,
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
      // recipeId only meaningful when category is food. Explicit
      // `undefined` tells the repo to drop the field.
      recipeId: category.value === 'food' && recipeId.value ? recipeId.value : undefined,
    };
    if (isEditing.value && props.favorite) {
      await favoritesStore.updateFavorite(props.favorite.id, payload);
    } else {
      await favoritesStore.createFavorite(payload);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.favorite) return;
  const ok = await confirm({
    title: 'favorites.deleteConfirm.title',
    message: 'favorites.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await favoritesStore.deleteFavorite(props.favorite.id);
  emit('close');
}

// Recipe picker is always visible for food favorites — the dropdown's
// "+ Add a new recipe…" sentinel is itself a meaningful option even
// when the cookbook is still empty, so there's never a case where the
// picker should hide. Kept as a computed for template readability.
const showRecipePicker = computed(() => category.value === 'food');
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="title"
    icon="💝"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('favorites.field.category')">
      <FrequencyChips
        :model-value="category"
        :options="categoryOptions"
        @update:model-value="(v: string) => (category = v as FavoriteCategory)"
      />
    </FormFieldGroup>

    <!-- Food favorites get a special block: recipe picker + "or" +
         free-text fallback. Matches the mockup's `.fav-food-block`. -->
    <div
      v-if="category === 'food'"
      class="flex flex-col gap-2.5 rounded-[14px] border border-[var(--tint-orange-15)] bg-[var(--tint-orange-8)] p-3.5"
    >
      <div class="font-outfit text-[11px] font-semibold tracking-[0.06em] text-[#E67E22] uppercase">
        {{ t('favorites.food.detailsLabel') }}
      </div>
      <p class="font-caveat -mt-1 text-base text-[#E67E22]">
        {{ t('favorites.food.hint') }}
      </p>

      <FormFieldGroup v-if="showRecipePicker" :label="t('favorites.field.recipe')">
        <BaseSelect v-model="recipeId" :options="recipeOptions" />
      </FormFieldGroup>

      <!-- "or" divider — hidden when there are no recipes to pick from,
           since the type-it-in input becomes the only option. -->
      <div
        v-if="showRecipePicker"
        class="font-outfit text-secondary-500/50 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase"
      >
        <span class="h-px flex-1 bg-[var(--tint-slate-10)]" aria-hidden="true" />
        <span>{{ t('favorites.food.or') }}</span>
        <span class="h-px flex-1 bg-[var(--tint-slate-10)]" aria-hidden="true" />
      </div>

      <FormFieldGroup
        :label="showRecipePicker ? t('favorites.field.typeItIn') : t('favorites.field.name')"
      >
        <BaseInput
          v-model="name"
          :placeholder="t('favorites.placeholder.typeItIn')"
          :disabled="!!recipeId"
        />
      </FormFieldGroup>
    </div>

    <!-- Non-food: plain Name field, unchanged from before. -->
    <FormFieldGroup v-else :label="t('favorites.field.name')" required>
      <BaseInput v-model="name" :placeholder="t('favorites.placeholder.name')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('favorites.field.why')" optional>
      <textarea
        v-model="description"
        rows="3"
        class="focus:border-primary-500 focus:ring-primary-500 font-caveat w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-lg leading-snug text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('favorites.placeholder.why')"
      />
    </FormFieldGroup>
  </BeanieFormModal>

  <!-- Layered recipe-add modal — opened via the dropdown's sentinel
       option. Emits `saved` with the new id, which we auto-select. -->
  <RecipeFormModal
    :open="showRecipeModal"
    :recipe="null"
    @close="showRecipeModal = false"
    @saved="onRecipeSaved"
  />
</template>
