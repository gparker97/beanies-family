<script setup lang="ts">
/**
 * A chore list being edited, by time of day (#146): the ONE layout of the Add Chores sheet's
 * list and a bean's chore list. Rows (`ChoreEditRow`) sit under Morning / Afternoon / Evening /
 * Anytime headings in the block colours, in block order; a heading shows when its block has
 * rows, and every block has its always-visible "+ Add to <block>" row, so any block can be
 * started without first choosing a time.
 *
 * It holds two things and decides nothing else:
 *  - which chooser is open (a row's time tiles, picture or days), one at a time across the list,
 *    with its Escape token. It closes when its row leaves the list and when a time is picked or
 *    a days shortcut is chosen; the list lives inside its host's drawer body, which unmounts
 *    when the sheet closes, so no token outlives what it was for;
 *  - each block's rows as a `vuedraggable` list, dragged by a row's handle and only with
 *    `reorder` (disabled otherwise, the draft sheet), the
 *    Beanie Lists pattern, `ListDetailModal`): vuedraggable mutates the array it is bound to IN
 *    PLACE, so it binds a LOCAL copy per block (never the host's items), and a move calls
 *    `reorder` with that block's draggable keys in their new order. A reorder that does not land
 *    leaves the host's items unchanged, so the copy is put back in their order here.
 * Every row intent is re-emitted with its row's key, for the host to answer.
 *
 * Dark mode: headings paint `--chore-tint` / `--chore-ink` (`.chore-block-*`); the add rows are
 * `accent-lift` text on a dashed orange-tint edge; the drag ghost uses `--tint-orange-15`, which
 * has its own dark value.
 */
import { computed, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import ChoreEditRow from '@/components/chores/ChoreEditRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { CHORE_BLOCKS } from '@/utils/chores';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreEditChooser, ChoreEditItem } from '@/components/chores/choreEditItem';
import type { ChoreBlock } from '@/types/models';

const props = withDefaults(
  defineProps<{
    items: readonly ChoreEditItem[];
    /** Send a block's new order (its draggable keys); resolves whether it landed. */
    reorder?: (block: ChoreBlock, keys: string[]) => Promise<boolean>;
  }>(),
  { reorder: undefined }
);

const emit = defineEmits<{
  commit: [key: string, title: string, enter: boolean];
  typing: [key: string, text: string];
  empty: [key: string];
  cancel: [key: string];
  time: [key: string, block: ChoreBlock];
  picture: [key: string, picture: { emoji: string; illustration: string }];
  days: [key: string, days: number[]];
  remove: [key: string];
  'add-row': [block: ChoreBlock];
}>();

const { t } = useTranslation();
const { prefersReducedMotion } = useReducedMotion();

// ── Blocks ───────────────────────────────────────────────────────────────────

function byBlock(items: readonly ChoreEditItem[]): Record<ChoreBlock, ChoreEditItem[]> {
  const out = { morning: [], afternoon: [], evening: [], anytime: [] } as Record<
    ChoreBlock,
    ChoreEditItem[]
  >;
  for (const item of items) out[item.block].push(item);
  return out;
}

/** Each block's rows as vuedraggable reorders them: local copies, re-seeded from the items. */
const lanes = ref(byBlock(props.items));
watch(
  () => props.items,
  (items) => {
    lanes.value = byBlock(items);
  }
);

const groups = computed(() =>
  CHORE_BLOCKS.map((block) => ({ block, meta: CHORE_BLOCK_META[block] }))
);

async function onMove(
  block: ChoreBlock,
  evt: { moved?: { oldIndex: number; newIndex: number } }
): Promise<void> {
  if (!props.reorder || !evt.moved || evt.moved.oldIndex === evt.moved.newIndex) return;
  const keys = lanes.value[block].filter((i) => i.draggable).map((i) => i.key);
  const landed = await props.reorder(block, keys);
  // Refused or failed (the store has toasted): put the block back in the host's order.
  if (!landed) lanes.value = byBlock(props.items);
}

// ── The one open chooser ─────────────────────────────────────────────────────

const chooser = ref<{ key: string; kind: ChoreEditChooser } | null>(null);

function toggleChooser(key: string, kind: ChoreEditChooser): void {
  chooser.value = chooser.value?.key === key && chooser.value.kind === kind ? null : { key, kind };
}
const chooserOf = (key: string) => (chooser.value?.key === key ? chooser.value.kind : null);

function closeChooser(): void {
  chooser.value = null;
}

useEscapeClose(
  computed(() => chooser.value !== null),
  closeChooser
);

// A chooser follows its row: when the row leaves the list (its ✕, Clear List, Remove from List,
// a delete on another device, sign-out), the chooser closes with it.
watch(
  () => props.items.map((i) => i.key),
  (keys) => {
    if (chooser.value && !keys.includes(chooser.value.key)) closeChooser();
  }
);

function onTime(key: string, block: ChoreBlock): void {
  closeChooser();
  emit('time', key, block);
}

function onDays(key: string, days: number[], preset: boolean): void {
  if (preset) closeChooser();
  emit('days', key, days);
}

// ── Focus ────────────────────────────────────────────────────────────────────

const rowRefs = new Map<string, { focus(): void }>();
function setRowRef(key: string, el: unknown): void {
  if (el && typeof (el as { focus?: unknown }).focus === 'function') {
    rowRefs.set(key, el as { focus(): void });
  } else {
    rowRefs.delete(key);
  }
}

/** Focus a row's title (a row just added). */
function focusRow(key: string): void {
  rowRefs.get(key)?.focus();
}
defineExpose({ focusRow });
</script>

<template>
  <div class="flex flex-col gap-3">
    <section
      v-for="g in groups"
      :key="g.block"
      class="flex flex-col gap-1.5"
      data-testid="chore-add-block"
      :data-block="g.block"
    >
      <!-- The block heading: a small chip in the block's colour, as the day summary's group heads. -->
      <h3
        v-if="lanes[g.block].length"
        class="font-outfit flex items-center gap-2 rounded-xl bg-[var(--chore-tint)] px-2.5 py-1.5 text-xs font-bold text-[var(--chore-ink)]"
        :class="g.meta.colorClass"
      >
        <span class="text-sm" aria-hidden="true">{{ g.meta.emoji }}</span>
        <span class="min-w-0 flex-1 truncate">{{ t(g.meta.labelKey) }}</span>
      </h3>
      <draggable
        v-if="lanes[g.block].length"
        v-model="lanes[g.block]"
        item-key="key"
        tag="ul"
        handle=".drag-handle"
        :disabled="!reorder"
        :animation="prefersReducedMotion ? 0 : 160"
        ghost-class="chore-edit-ghost"
        class="flex flex-col gap-1.5"
        data-testid="chore-edit-rows"
        :data-block="g.block"
        @change="onMove(g.block, $event)"
      >
        <template #item="{ element: item }">
          <ChoreEditRow
            :ref="(el) => setRowRef(item.key, el)"
            :item="item"
            :chooser="chooserOf(item.key)"
            @commit="(title, enter) => emit('commit', item.key, title, enter)"
            @typing="emit('typing', item.key, $event)"
            @empty="emit('empty', item.key)"
            @cancel="emit('cancel', item.key)"
            @chooser="toggleChooser(item.key, $event)"
            @time="onTime(item.key, $event)"
            @picture="emit('picture', item.key, $event)"
            @days="(days, preset) => onDays(item.key, days, preset)"
            @remove="emit('remove', item.key)"
          />
        </template>
      </draggable>
      <button
        type="button"
        class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 flex min-h-11 w-full items-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--tint-orange-15)] px-3 py-1.5 text-left text-sm font-bold focus-visible:ring-2 focus-visible:outline-none"
        data-testid="chore-add-row"
        :data-block="g.block"
        @click="emit('add-row', g.block)"
      >
        <span aria-hidden="true">+ {{ g.meta.emoji }}</span>
        {{ fillTemplate(t('choreboard.starter.addInBlock'), { block: t(g.meta.labelKey) }) }}
      </button>
    </section>
  </div>
</template>

<style scoped>
/* Drag placeholder while reordering a chore (the Beanie Lists item ghost: orange ring + lift).
   `--tint-orange-15` has its own dark value in `src/style.css`, so one rule serves both themes. */
.chore-edit-ghost {
  background: var(--tint-orange-15);
  border-radius: 0.75rem;
  box-shadow: 0 0 0 2px var(--color-primary-500);
  opacity: 0.9;
}
</style>
