<script setup lang="ts">
/**
 * Add/edit a FavoriteItem for a specific bean. Drawer-style
 * BeanieFormModal, save/cancel, delete visible in edit mode.
 *
 * The `recipeId` picker (for food favorites that link to a cookbook
 * recipe) ships in P4 alongside `recipesStore`. For now food favorites
 * just capture free-text name + description, matching the mockup's
 * "McDonald's Happy Meal" / "grandma's carbonara" input shape.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useFavoritesStore } from '@/stores/favoritesStore';
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

const name = ref('');
const description = ref('');
const category = ref<FavoriteCategory>('food');

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
    },
    onNew: () => {
      name.value = '';
      description.value = '';
      category.value = 'food';
    },
  }
);

const canSave = computed(() => name.value.trim().length > 0);

const title = computed(() =>
  isEditing.value ? t('favorites.editTitle') : t('favorites.addTitle')
);

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const payload = {
      memberId: props.memberId,
      category: category.value,
      name: name.value.trim(),
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
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

    <FormFieldGroup :label="t('favorites.field.name')" required>
      <BaseInput v-model="name" :placeholder="t('favorites.placeholder.name')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('favorites.field.description')" optional>
      <BaseInput v-model="description" :placeholder="t('favorites.placeholder.description')" />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
