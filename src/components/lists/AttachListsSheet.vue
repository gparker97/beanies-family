<script setup lang="ts">
/**
 * Attach lists the family already has to a trip or an activity session: search, pick several,
 * one write (`listStore.attachLists`).
 *
 * Only lists with no link of the target's kind are offered (`listStore.attachableLists`), so
 * attaching never silently moves a list off another trip or activity; the footnote says where
 * such a list is moved from instead. The selection follows the live candidates: a list linked
 * elsewhere, filed or deleted on another device while the sheet is open leaves the pick (and
 * stays unpicked if it comes back), and `listStore.attachLists` re-checks the rule as a backstop
 * just before the write.
 *
 * MUST stay mounted while closed: `useFormModal`'s reset is a plain, non-immediate `watch(open)`
 * (see `ListCopyModal`). Logging is the host section's: this emits what happened.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ListChoiceRow from '@/components/lists/ListChoiceRow.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import type { ListLinkTarget } from '@/utils/activityLinks';

const props = defineProps<{
  open: boolean;
  target: ListLinkTarget;
  /** Open above another open drawer (the activity drawer). */
  stacked?: boolean;
}>();
const emit = defineEmits<{
  close: [];
  /** `count` lists were linked; `partial` when some of the pick had gone by the write. */
  attached: [count: number, partial: boolean];
  /** The write failed (already toasted + reported by the store). */
  failed: [count: number];
}>();

const { t } = useTranslation();
const listStore = useListStore();

const search = ref('');
const picked = ref<Set<string>>(new Set());

const candidates = computed(() => listStore.attachableLists(props.target.kind));
const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? candidates.value.filter((l) => l.title.toLowerCase().includes(q)) : candidates.value;
});
// Follows the live candidates: a picked list that stops being attachable is no longer counted.
// Rows hidden only by the search stay picked.
const selectedIds = computed(() =>
  candidates.value.filter((l) => picked.value.has(l.id)).map((l) => l.id)
);

// A row that leaves the candidates leaves the pick too, so it never comes back pre-selected.
watch(candidates, (now) => {
  const live = new Set(now.map((l) => l.id));
  if ([...picked.value].some((id) => !live.has(id))) {
    picked.value = new Set([...picked.value].filter((id) => live.has(id)));
  }
});

function toggle(id: string): void {
  const next = new Set(picked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  picked.value = next;
}

function reset(): void {
  search.value = '';
  picked.value = new Set();
}

const { isSubmitting } = useFormModal(
  () => null,
  () => props.open,
  { onNew: reset, onEdit: reset }
);

async function onSave(): Promise<void> {
  // Guard AND the bound `is-submitting`: a double tap must not write twice.
  if (isSubmitting.value || !selectedIds.value.length) return;
  const ids = selectedIds.value;
  isSubmitting.value = true;
  try {
    const attached = await listStore.attachLists(ids, props.target);
    // Falsy, not `=== null`, as `ListCopyModal`: the store has already toasted and reported,
    // so no second toast. The sheet stays open with the pick, ready for a retry.
    if (!attached) {
      emit('failed', ids.length);
      return;
    }
    emit('attached', attached.length, attached.length < ids.length);
    // Nothing attached: every pick was deleted on another device during the write (the repo
    // skips missing ids). Those rows have left the sheet, so it stays open on what is still
    // attachable rather than closing as if it had worked.
    if (!attached.length) return;
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('linkedLists.attach')"
    icon="📋"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :layer="stacked ? 'overlay' : 'base'"
    :save-label="t('linkedLists.attachAction')"
    :save-disabled="selectedIds.length === 0"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onSave"
  >
    <div class="space-y-3">
      <BaseInput
        v-if="candidates.length"
        v-model="search"
        :placeholder="t('lists.detail.linkSearch')"
      />
      <p
        v-if="!candidates.length"
        class="dark:text-ink-faint text-sm text-[var(--color-text-muted)]"
        data-testid="attach-lists-empty"
      >
        {{ t('linkedLists.attachEmpty') }}
      </p>
      <p
        v-else-if="!shown.length"
        class="dark:text-ink-faint text-sm text-[var(--color-text-muted)]"
        data-testid="attach-lists-no-match"
      >
        {{ t('lists.detail.noMatches') }}
      </p>
      <div v-else class="space-y-2">
        <ListChoiceRow
          v-for="list in shown"
          :key="list.id"
          :list="list"
          selectable
          :selected="picked.has(list.id)"
          @click="toggle(list.id)"
        />
      </div>
      <p class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        <span aria-hidden="true">🌱</span> {{ t('linkedLists.attachNote') }}
      </p>
    </div>
  </BeanieFormModal>
</template>
