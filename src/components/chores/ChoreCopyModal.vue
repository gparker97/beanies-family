<script setup lang="ts">
/**
 * Copy one bean's chores to other beans, by block (#146). Mirrors `ListCopyModal`: two
 * controls (who to copy to, which blocks), ONE atomic write (`choreStore.copyChores`), so the
 * only outcomes are "copied (and N skipped as duplicates)" or "nothing happened, and you have
 * been told why". Each copy is the target's own chore to edit; a chore the target already has
 * by the same name in the same block is skipped, and the toast says how many.
 *
 * MUST stay mounted while closed. `useFormModal`'s reset runs on the open transition, so a
 * `v-if`-gated instance would open with the previous selection still in place.
 *
 * Dark mode: the block rows paint their `--chore-tint` glyph on `surface-overlay`; text is
 * `ink` / `ink-faint`.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { showChoreBatchToast } from '@/composables/choreBatchToast';
import { useChoreStore } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { CHORE_BLOCKS, choreBlockOf } from '@/utils/chores';
import { formatNameList, membersByIds } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreBlock, FamilyMember } from '@/types/models';

const props = defineProps<{ open: boolean; sourceMemberId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const choreStore = useChoreStore();
const familyStore = useFamilyStore();

const source = computed<FamilyMember | undefined>(() =>
  props.sourceMemberId ? familyStore.members.find((m) => m.id === props.sourceMemberId) : undefined
);

/** Everyone a copy can go to: living people other than the source. */
const targets = computed(() =>
  familyStore.sortedHumans.filter((m) => m.id !== props.sourceMemberId)
);

/** The source's chores per block (every day, not just today). */
const perBlock = computed(() => {
  const counts = new Map<ChoreBlock, number>();
  for (const c of choreStore.sortedChores) {
    if (!(c.assigneeIds ?? []).includes(props.sourceMemberId ?? '')) continue;
    const b = choreBlockOf(c);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return counts;
});
const blockRows = computed(() =>
  CHORE_BLOCKS.filter((b) => (perBlock.value.get(b) ?? 0) > 0).map((b) => ({
    block: b,
    count: perBlock.value.get(b) ?? 0,
  }))
);

const selectedIds = ref<string[]>([]);
const blocks = ref<ChoreBlock[]>([]);

function reset(): void {
  selectedIds.value = [];
  blocks.value = blockRows.value.map((r) => r.block);
}

const { isSubmitting } = useFormModal(
  () => source.value,
  () => props.open,
  { onEdit: reset, onNew: reset }
);

function toggleBlock(b: ChoreBlock): void {
  blocks.value = blocks.value.includes(b)
    ? blocks.value.filter((x) => x !== b)
    : [...blocks.value, b];
}

const chosen = computed(() => membersByIds(familyStore.members, selectedIds.value));
const choreCount = computed(() =>
  blockRows.value.filter((r) => blocks.value.includes(r.block)).reduce((n, r) => n + r.count, 0)
);

const saveLabel = computed(() => {
  if (!chosen.value.length || !choreCount.value) return t('choreboard.copy.saveNone');
  return fillTemplate(
    t(choreCount.value === 1 ? 'choreboard.copy.save.one' : 'choreboard.copy.save.other'),
    { count: choreCount.value, names: formatNameList(chosen.value.map((m) => m.name)) }
  );
});

// Genuinely unavailable (nothing to copy, nobody to copy to), as in `ListCopyModal`.
const saveDisabled = computed(() => chosen.value.length === 0 || choreCount.value === 0);

const title = computed(() =>
  fillTemplate(t('choreboard.copy.title'), { name: source.value?.name ?? '' })
);

const blockCount = (count: number) =>
  fillTemplate(t(count === 1 ? 'choreboard.block.chores.one' : 'choreboard.block.chores.other'), {
    count,
  });

async function onSave(): Promise<void> {
  // The guard AND the bound `is-submitting` are both needed: the write is atomic, which
  // prevents a partial batch, not a second batch. Without this a double-tap copies twice
  // (the second batch would be all skips, but it is still a second write).
  if (isSubmitting.value || !props.sourceMemberId || saveDisabled.value) return;
  const actorId = familyStore.currentMemberId;
  if (!actorId) return;
  isSubmitting.value = true;
  try {
    const result = await choreStore.copyChores(
      props.sourceMemberId,
      chosen.value.map((m) => m.id),
      [...blocks.value],
      actorId
    );
    // null: the store has already toasted and reported. Toasting again would double it.
    if (!result) return;
    showChoreBatchToast(
      result,
      { one: 'choreboard.copy.done.one', other: 'choreboard.copy.done.other' },
      t
    );
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="title"
    icon="📋"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="saveLabel"
    :save-disabled="saveDisabled"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onSave"
  >
    <div class="space-y-5" data-testid="chore-copy-modal">
      <FormFieldGroup :label="t('choreboard.copy.to')">
        <FamilyChipPicker
          v-if="targets.length"
          v-model="selectedIds"
          mode="multi"
          :members="targets"
        />
        <p v-else class="dark:text-ink-faint text-secondary-400 text-sm">
          {{ t('choreboard.copy.noOthers') }}
        </p>
      </FormFieldGroup>

      <FormFieldGroup :label="t('choreboard.copy.which')">
        <ul class="flex flex-col gap-1.5">
          <li v-for="row in blockRows" :key="row.block">
            <label
              class="dark:bg-surface-overlay flex cursor-pointer items-center gap-3 rounded-xl bg-[var(--tint-slate-5)] px-3 py-2 text-sm"
              data-testid="chore-copy-block"
              :data-block="row.block"
            >
              <input
                type="checkbox"
                class="accent-primary-500 h-5 w-5 flex-none"
                :checked="blocks.includes(row.block)"
                @change="toggleBlock(row.block)"
              />
              <span
                class="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--chore-tint)]"
                :class="CHORE_BLOCK_META[row.block].colorClass"
                aria-hidden="true"
                >{{ CHORE_BLOCK_META[row.block].emoji }}</span
              >
              <span
                class="font-outfit dark:text-ink text-secondary-500 min-w-0 flex-1 font-semibold"
                >{{ t(CHORE_BLOCK_META[row.block].labelKey) }}</span
              >
              <span class="dark:text-ink-faint text-secondary-400 text-xs">{{
                blockCount(row.count)
              }}</span>
            </label>
          </li>
        </ul>
        <p class="dark:text-ink-faint text-secondary-400 mt-2 text-xs">
          {{ t('choreboard.copy.hint') }}
        </p>
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
