<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useCardDefaultHint } from '@/composables/useCardDefaultHint';
import { logEvent } from '@/services/telemetry/logEvent';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { LIST_TEMPLATES, getListTemplatesForCategory } from '@/constants/listTemplates';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import ListCategoryPills from './ListCategoryPills.vue';
import type { CreateFamilyListInput, ListCategory } from '@/types/models';

const props = defineProps<{
  open: boolean;
  /**
   * Caller-fixed fields for the new list (e.g. the activity link, #114), spread LAST into both
   * create paths so they always win over the sheet's own choices (category pill, card holder).
   */
  overrides?: Partial<CreateFamilyListInput>;
  /** A template to list first with a "Suggested" badge (e.g. party prep on a birthday). */
  suggestedTemplateKey?: string;
  /** Stack above another open drawer (e.g. when opened from the activity drawer). */
  stacked?: boolean;
}>();
// `templateKey` is set when the list came from a template, absent for a blank list.
const emit = defineEmits<{
  close: [];
  created: [id: string, templateKey?: string];
  /**
   * The create returned nothing. The store has already surfaced why: a toast + report for
   * a refused owner or a failed write, an error event for an unknown template key.
   */
  failed: [templateKey?: string];
}>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();

const meId = computed(() => familyStore.currentMember?.id ?? '');
const selectedCategory = ref<ListCategory | null>(null);

const templates = computed(() => {
  const shown = selectedCategory.value
    ? getListTemplatesForCategory(selectedCategory.value)
    : LIST_TEMPLATES;
  const suggested = shown.find((tmpl) => tmpl.key === props.suggestedTemplateKey);
  return suggested ? [suggested, ...shown.filter((tmpl) => tmpl !== suggested)] : shown;
});

function reset(): void {
  selectedCategory.value = null;
}
function close(): void {
  reset();
  emit('close');
}

// Who Owns What (#109): a template mapped to a card (`CARD_DEFAULTS.listTemplate`) owns
// the new list with that card's single holder. The hint shows on the tile BEFORE the pick
// (the sheet closes on pick) and is derived, never stored.
const { holderFor, holdsHint } = useCardDefaultHint();
const tileHints = computed<Record<string, string>>(() =>
  Object.fromEntries(
    templates.value.map((tmpl) => [tmpl.key, holdsHint({ kind: 'listTemplate', key: tmpl.key })])
  )
);

async function pickTemplate(key: string): Promise<void> {
  const overrides: Partial<CreateFamilyListInput> = selectedCategory.value
    ? { category: selectedCategory.value }
    : {};
  // `meId` stays the creator (`createdBy`); only the owner comes from the card.
  const holder = holderFor({ kind: 'listTemplate', key });
  if (holder) {
    overrides.ownerId = holder.memberId;
    logEvent({
      level: 'info',
      surface: 'lists',
      message: 'card_default_applied',
      context: { action: 'card_default_applied', detail: key },
    });
  }
  const created = await listStore.createFromTemplate(key, meId.value, {
    ...overrides,
    ...props.overrides,
  });
  if (created) emit('created', created.id, key);
  else emit('failed', key);
  close();
}

async function startBlank(): Promise<void> {
  const created = await listStore.createBlankList(meId.value, {
    category: selectedCategory.value ?? 'home',
    ...props.overrides,
  });
  if (created) emit('created', created.id);
  else emit('failed');
  close();
}

// Watch open → reset selection when (re)opened.
const isOpen = computed(() => props.open);
</script>

<template>
  <BaseModal
    :open="isOpen"
    :title="t('lists.new.title')"
    size="lg"
    :layer="stacked ? 'overlay' : 'base'"
    @close="close"
  >
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
            <span class="flex items-start justify-between gap-2">
              <span class="text-2xl" aria-hidden="true">{{ tmpl.icon }}</span>
              <span
                v-if="tmpl.key === suggestedTemplateKey"
                class="font-outfit text-primary-600 dark:text-accent-lift rounded-full bg-[var(--tint-orange-15)] px-2 py-px text-xs font-bold"
                data-testid="suggested-badge"
                >{{ t('lists.new.suggested') }}</span
              >
            </span>
            <span class="font-outfit text-sm font-bold text-[var(--color-text)]">{{
              t(tmpl.nameKey)
            }}</span>
            <span class="text-xs text-[var(--color-text-muted)]">{{ t(tmpl.descriptionKey) }}</span>
            <InferredHint :text="tileHints[tmpl.key]" />
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
