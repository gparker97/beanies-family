<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useToday } from '@/composables/useToday';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { LIST_CATEGORIES } from '@/constants/listCategories';
import { isRecurring } from '@/utils/listLifecycle';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import type { ListCategory, ListFrequency } from '@/types/models';

const props = defineProps<{ listId: string | null }>();
const emit = defineEmits<{ close: []; deleted: [id: string] }>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();
const { today } = useToday();
const { categoryLabel } = useListCategoryLabel();

// Live lookup so the modal stays reactive as the store mutates.
const list = computed(() =>
  props.listId ? (listStore.lists.find((l) => l.id === props.listId) ?? null) : null
);

const meId = computed(() => familyStore.currentMember?.id ?? '');

// Local title draft (saved on blur) — everything else writes through immediately.
const draftTitle = ref('');
watch(
  list,
  (l) => {
    if (l) draftTitle.value = l.title;
  },
  { immediate: true }
);

function saveTitle(): void {
  const l = list.value;
  if (!l) return;
  const next = draftTitle.value.trim();
  if (next && next !== l.title) void listStore.updateList(l.id, { title: next });
}

const categoryOptions = computed(() =>
  LIST_CATEGORIES.map((c) => ({ value: c.id, label: categoryLabel(c.id) }))
);
function setCategory(value: string | number): void {
  if (list.value) void listStore.updateList(list.value.id, { category: value as ListCategory });
}

function setOwner(value: string | string[]): void {
  const id = Array.isArray(value) ? value[0] : value;
  if (list.value && id) void listStore.updateList(list.value.id, { ownerId: id });
}

const lifecycleOptions = computed(() => [
  { value: 'oneoff', label: t('lists.detail.oneoff') },
  { value: 'recurring', label: t('lists.detail.recurring') },
]);
function setLifecycle(value: string): void {
  const l = list.value;
  if (!l) return;
  if (value === 'recurring') {
    void listStore.updateList(l.id, {
      lifecycle: 'recurring',
      frequency: l.frequency ?? 'weekly',
      dueDate: undefined,
      lastResetDate: today.value,
      cycleCelebrated: false,
    });
  } else {
    void listStore.updateList(l.id, {
      lifecycle: 'oneoff',
      frequency: undefined,
      lastResetDate: undefined,
      cycleCelebrated: undefined,
    });
  }
}

const freqOptions = computed(() => [
  { value: 'daily', label: t('lists.detail.freq.daily') },
  { value: 'weekly', label: t('lists.detail.freq.weekly') },
  { value: 'monthly', label: t('lists.detail.freq.monthly') },
]);
function setFrequency(value: string): void {
  if (list.value) void listStore.updateList(list.value.id, { frequency: value as ListFrequency });
}

function setDueDate(value: string): void {
  if (list.value) void listStore.updateList(list.value.id, { dueDate: value || undefined });
}

function toggleItem(itemId: string): void {
  if (list.value) void listStore.toggleItem(list.value.id, itemId, meId.value);
}
function removeItem(itemId: string): void {
  if (list.value) void listStore.removeItem(list.value.id, itemId);
}

const newItem = ref('');
function addItem(): void {
  const title = newItem.value.trim();
  if (list.value && title) {
    void listStore.addItem(list.value.id, title);
    newItem.value = '';
  }
}

async function handleDelete(): Promise<void> {
  const l = list.value;
  if (!l) return;
  const ok = await showConfirm({
    title: 'lists.detail.deleteConfirm.title',
    message: 'lists.detail.deleteConfirm.message',
    variant: 'danger',
  });
  if (!ok) return;
  await listStore.deleteList(l.id);
  emit('deleted', l.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    v-if="list"
    variant="drawer"
    :open="true"
    :title="list.title"
    :icon="list.emoji"
    icon-bg="var(--tint-orange-12)"
    size="narrow"
    :save-label="t('action.close')"
    save-gradient="orange"
    :show-delete="true"
    @close="emit('close')"
    @save="emit('close')"
    @delete="handleDelete"
  >
    <div class="space-y-5">
      <!-- Name -->
      <BaseInput
        v-model="draftTitle"
        :label="t('lists.detail.titlePlaceholder')"
        :placeholder="t('lists.detail.titlePlaceholder')"
        @blur="saveTitle"
      />

      <!-- Meta: category + owner -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BaseSelect
          :model-value="list.category"
          :options="categoryOptions"
          :label="t('lists.new.categoryLabel')"
          @update:model-value="setCategory"
        />
        <div>
          <p class="lists-label">{{ t('lists.detail.owner') }}</p>
          <FamilyChipPicker
            :model-value="list.ownerId"
            mode="single"
            compact
            @update:model-value="setOwner"
          />
        </div>
      </div>

      <!-- Items -->
      <div>
        <p class="lists-label">{{ t('lists.title') }}</p>
        <ul class="space-y-1.5">
          <li
            v-for="item in list.items"
            :key="item.id"
            class="flex items-center gap-2.5 rounded-xl border border-[var(--color-border)] px-3 py-2"
          >
            <button
              type="button"
              class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 text-white transition-colors"
              :class="
                item.completed
                  ? 'border-[var(--color-success)] bg-[var(--color-success)]'
                  : 'border-[var(--color-border)]'
              "
              :aria-label="item.title"
              @click="toggleItem(item.id)"
            >
              <span v-if="item.completed" aria-hidden="true" class="text-xs">✓</span>
            </button>
            <span
              class="flex-1 text-sm"
              :class="
                item.completed
                  ? 'text-[var(--color-text-muted)] line-through'
                  : 'text-[var(--color-text)]'
              "
            >
              {{ item.title }}
            </span>
            <button
              type="button"
              class="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary-500)]"
              :aria-label="t('action.delete')"
              @click="removeItem(item.id)"
            >
              ✕
            </button>
          </li>
        </ul>
        <div class="mt-2 flex items-center gap-2">
          <BaseInput
            v-model="newItem"
            :placeholder="t('lists.detail.addItem')"
            @keyup.enter="addItem"
          />
        </div>
      </div>

      <!-- Repeats? -->
      <div>
        <p class="lists-label">{{ t('lists.detail.repeatsLabel') }}</p>
        <TogglePillGroup
          :model-value="isRecurring(list) ? 'recurring' : 'oneoff'"
          :options="lifecycleOptions"
          @update:model-value="setLifecycle"
        />
        <template v-if="isRecurring(list)">
          <div class="mt-2">
            <FrequencyChips
              :model-value="list.frequency ?? 'weekly'"
              :options="freqOptions"
              @update:model-value="setFrequency"
            />
          </div>
          <p class="mt-2 text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.recurringHint') }}
          </p>
        </template>
      </div>

      <!-- Due date (one-off only) -->
      <div v-if="!isRecurring(list)">
        <p class="lists-label">{{ t('lists.detail.dueDateLabel') }}</p>
        <BeanieDatePicker :model-value="list.dueDate ?? ''" @update:model-value="setDueDate" />
      </div>
    </div>
  </BeanieFormModal>
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
