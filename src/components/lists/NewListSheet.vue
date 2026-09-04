<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getListCategory } from '@/constants/listCategories';
import { LIST_TEMPLATES, getListTemplatesForCategory } from '@/constants/listTemplates';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ListCategoryPills from './ListCategoryPills.vue';
import type { ListCategory } from '@/types/models';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [id: string] }>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();

const meId = computed(() => familyStore.currentMember?.id ?? '');
const selectedCategory = ref<ListCategory | null>(null);

const templates = computed(() =>
  selectedCategory.value ? getListTemplatesForCategory(selectedCategory.value) : LIST_TEMPLATES
);

function reset(): void {
  selectedCategory.value = null;
}
function close(): void {
  reset();
  emit('close');
}

async function pickTemplate(key: string): Promise<void> {
  const overrides = selectedCategory.value ? { category: selectedCategory.value } : {};
  const created = await listStore.createFromTemplate(key, meId.value, overrides);
  if (created) emit('created', created.id);
  close();
}

async function startBlank(): Promise<void> {
  const category = selectedCategory.value ?? 'home';
  const created = await listStore.createList({
    title: t('lists.new.blankTitle'),
    emoji: getListCategory(category)?.emoji ?? '📝',
    category,
    ownerId: meId.value,
    items: [],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: meId.value,
  });
  if (created) emit('created', created.id);
  close();
}

// Watch open → reset selection when (re)opened.
const isOpen = computed(() => props.open);
</script>

<template>
  <BaseModal :open="isOpen" :title="t('lists.new.title')" size="lg" @close="close">
    <div class="space-y-5">
      <p class="text-sm text-[var(--color-text-muted)]">{{ t('lists.new.subtitle') }}</p>

      <!-- Category pills -->
      <div>
        <p class="lists-label">{{ t('lists.new.categoryLabel') }}</p>
        <ListCategoryPills v-model="selectedCategory" clearable short />
      </div>

      <!-- Templates -->
      <div>
        <p class="lists-label">{{ t('lists.new.templatesLabel') }}</p>
        <div class="grid grid-cols-2 gap-2.5">
          <button
            v-for="tmpl in templates"
            :key="tmpl.key"
            type="button"
            class="dark:bg-surface-raised dark:border-line-strong flex flex-col gap-1 rounded-2xl border border-[var(--color-border)] bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary-500)] hover:shadow-md"
            @click="pickTemplate(tmpl.key)"
          >
            <span class="text-2xl" aria-hidden="true">{{ tmpl.icon }}</span>
            <span class="font-outfit text-sm font-bold text-[var(--color-text)]">{{
              t(tmpl.nameKey)
            }}</span>
            <span class="text-xs text-[var(--color-text-muted)]">{{ t(tmpl.descriptionKey) }}</span>
          </button>
        </div>
      </div>

      <BaseButton variant="primary" class="w-full" @click="startBlank">
        {{ t('lists.new.blank') }}
      </BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.lists-label {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}
</style>
