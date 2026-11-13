<script setup lang="ts">
/**
 * One time-of-day block of a bean's day on the choreboard page (#146), in its block colour.
 * Every state comes from the ONE read model (`beanChoreDay` → `ChoreDayBlock`), nothing here
 * decides "done" or "now":
 *
 *  - open:    the colour header (with the Heritage Orange ring and "Now" tag when it is the block
 *             happening now) and its chores, tickable;
 *  - later:   one quiet line in the block colour (day view: tap to open it);
 *  - done:    every chore ticked. On a bean's day, the block happening now (and Anytime) shows
 *             the all-done `CelebrationBanner` with one star per chore; elsewhere it folds to a
 *             one-line "All Done" strip with its stars. Either can reopen its chores, so a tick
 *             made by mistake can be undone. The celebration itself is the store's (once per
 *             bean, block and day); this only ever draws the banner.
 *
 * Reorder (grown-ups, a bean's day): with `reorderable`, the rows are a `vuedraggable` list
 * dragged by each row's handle, the Beanie Lists pattern (`ListDetailModal`): vuedraggable
 * mutates the array it is bound to IN PLACE, so it binds a LOCAL copy of the rows (never the
 * read model), and a move calls the page's `reorder` with the new id order (the page sends it to
 * `choreStore.reorderChores`); the store's re-read then flows back through the watcher. A
 * reorder that does not land (refused, failed) leaves the read model untouched, so the watcher
 * never fires: the section puts its copy back in the stored order itself.
 *
 * Select mode (`selecting`, a bean's day): every row shows, collapsed blocks included, each with
 * its selection checkbox; dragging is off.
 *
 * Colours: the block's tint and ink come from `.chore-block-*` (`src/style.css`), which holds
 * their dark partners. The done strip is the orange tint with `primary-700` / `accent-lift`
 * ink. The banner is the fixed brand gradient with white ink in both themes.
 */
import { computed, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import ChoreRow from '@/components/chores/ChoreRow.vue';
import CelebrationBanner from '@/components/ui/CelebrationBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { CHORE_BLOCK_META, choreEmoji } from '@/constants/choreBlocks';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatTime12 } from '@/utils/date';
import type { ChoreDayBlock, ChoreDayItem } from '@/utils/chores';
import type { ChoreBlockStarts } from '@/types/models';

const props = withDefaults(
  defineProps<{
    block: ChoreDayBlock;
    memberId: string;
    /** The bean's first name, for the banner's "Nice work, {name}." */
    beanName: string;
    variant?: 'card' | 'day';
    /** Show the chores (the Now block, Anytime). False draws the quiet "later" line. */
    open?: boolean;
    /** A finished block draws the big banner (true) or the one-line strip (false). */
    celebrate?: boolean;
    starts: ChoreBlockStarts;
    canTick?: boolean;
    canEdit?: boolean;
    isPending?: (choreId: string) => boolean;
    /** A grown-up may drag the rows into a new order (a bean's day only). */
    reorderable?: boolean;
    /** Send a new order; resolves whether it landed (a bean's day passes `choreStore`'s). */
    reorder?: (choreIds: string[]) => Promise<boolean>;
    /** Select mode, and which chores are selected. */
    selecting?: boolean;
    selectedIds?: readonly string[];
  }>(),
  {
    reorderable: false,
    reorder: undefined,
    selecting: false,
    selectedIds: () => [],
    variant: 'day',
    open: true,
    celebrate: false,
    canTick: true,
    canEdit: false,
    isPending: () => false,
  }
);

const emit = defineEmits<{
  toggle: [choreId: string];
  edit: [choreId: string];
  select: [choreId: string];
}>();

const { t } = useTranslation();
const { prefersReducedMotion } = useReducedMotion();

/** The rows as vuedraggable reorders them: a local copy, re-seeded from the read model. */
const rowsDraft = ref<ChoreDayItem[]>([]);
watch(
  () => props.block.chores,
  (items) => {
    rowsDraft.value = [...items];
  },
  { immediate: true }
);
/** Dragging needs something to reorder, and is off while selecting. */
const canDrag = computed(
  () => props.reorderable && !props.selecting && props.block.chores.length > 1
);

async function onRowMove(evt: { moved?: { oldIndex: number; newIndex: number } }): Promise<void> {
  if (!evt.moved || evt.moved.oldIndex === evt.moved.newIndex) return;
  const landed = props.reorder
    ? await props.reorder(rowsDraft.value.map((i) => i.chore.id))
    : false;
  // Refused or failed (the store has toasted): put the rows back in the order they are stored.
  if (!landed) rowsDraft.value = [...props.block.chores];
}

/** A later line, a done strip or the banner opened by hand to see its chores. */
const expanded = ref(false);

const meta = computed(() => CHORE_BLOCK_META[props.block.block]);
const label = computed(() => t(meta.value.labelKey));
const isCard = computed(() => props.variant === 'card');

type State = 'open' | 'later' | 'done' | 'banner';
const state = computed<State>(() => {
  if (props.block.allDone) return props.celebrate && !isCard.value ? 'banner' : 'done';
  return props.open ? 'open' : 'later';
});
const showRows = computed(() => state.value === 'open' || expanded.value || props.selecting);
const isSelected = (id: string) => props.selectedIds.includes(id);

/** The hour this block ends: the next block's start. Evening runs to midnight; Anytime has none. */
const endsAt = computed(() => {
  if (props.block.block === 'morning') return props.starts.afternoon;
  if (props.block.block === 'afternoon') return props.starts.evening;
  return '';
});
const startsAt = computed(() => {
  const b = props.block.block;
  return b === 'anytime' ? '' : props.starts[b];
});

const subtitle = computed(() => {
  if (props.block.block === 'anytime') return t('choreboard.block.anytimeHint');
  if (props.block.isNow) {
    return endsAt.value
      ? fillTemplate(t('choreboard.now.until'), { time: formatTime12(endsAt.value) })
      : '';
  }
  if (props.block.ended) return '';
  return fillTemplate(t('choreboard.block.from'), { time: formatTime12(startsAt.value) });
});

const left = computed(() => props.block.total - props.block.done);
const countText = computed(() =>
  isCard.value || props.block.ended
    ? fillTemplate(t('choreboard.block.count'), {
        done: props.block.done,
        total: props.block.total,
      })
    : fillTemplate(t('choreboard.block.toGo'), { count: left.value })
);
/** The chores a later line counts (what is left once its block has ended), and its plural. */
const choresText = computed(() => {
  const n = props.block.ended ? left.value : props.block.total;
  return fillTemplate(
    t(n === 1 ? 'choreboard.block.chores.one' : 'choreboard.block.chores.other'),
    { count: n }
  );
});
/** Up to four chore glyphs on a later line: a peek at what is coming. */
const peek = computed(() => props.block.chores.slice(0, 4).map((i) => choreEmoji(i.chore)));
const stars = computed(() => '⭐'.repeat(props.block.total));

const bannerTitle = computed(() =>
  fillTemplate(t('choreboard.done.title'), { block: label.value })
);
const bannerBody = computed(() =>
  fillTemplate(
    t(props.block.total === 1 ? 'choreboard.done.body.one' : 'choreboard.done.body.other'),
    { count: props.block.total, name: props.beanName }
  )
);
const toggleLabel = computed(() =>
  fillTemplate(t(expanded.value ? 'choreboard.block.collapse' : 'choreboard.block.expand'), {
    block: label.value,
  })
);
</script>

<template>
  <section
    class="flex flex-col"
    :class="[
      isCard ? 'gap-1.5' : 'gap-2',
      state === 'open' && !isCard
        ? 'dark:bg-surface-raised dark:border-line overflow-hidden rounded-3xl bg-white shadow-[var(--card-shadow)] dark:border'
        : '',
      state === 'open' && !isCard && block.isNow
        ? 'ring-primary-500 shadow-[0_10px_28px_rgba(241,93,34,0.16)] ring-2'
        : '',
    ]"
    data-testid="chore-block"
    :data-block="block.block"
    :data-state="state"
    :data-now="block.isNow ? 'true' : 'false'"
  >
    <!-- The all-done banner: a bean's day, the block happening now (or Anytime). -->
    <template v-if="state === 'banner'">
      <CelebrationBanner
        :title="bannerTitle"
        :body="bannerBody"
        :image-alt="t('choreboard.done.imageAlt')"
        :action-label="t(expanded ? 'choreboard.block.hideChores' : 'choreboard.block.showChores')"
        data-testid="chore-done-banner"
        @action="expanded = !expanded"
      >
        <p class="flex flex-wrap justify-center gap-0.5 text-2xl leading-none" aria-hidden="true">
          {{ stars }}
        </p>
      </CelebrationBanner>
    </template>

    <!-- The one-line "All Done" strip, with its stars. -->
    <component
      :is="isCard ? 'div' : 'button'"
      v-else-if="state === 'done'"
      :type="isCard ? undefined : 'button'"
      class="font-outfit text-primary-700 dark:text-accent-lift flex w-full items-center gap-2 bg-[var(--tint-orange-8)] text-left font-bold"
      :class="isCard ? 'rounded-xl px-2.5 py-1.5 text-xs' : 'rounded-2xl px-4 py-3 text-sm'"
      :aria-expanded="isCard ? undefined : expanded ? 'true' : 'false'"
      :aria-label="isCard ? undefined : toggleLabel"
      data-testid="chore-done-strip"
      @click="!isCard && (expanded = !expanded)"
    >
      <span aria-hidden="true">{{ meta.emoji }}</span>
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <span class="truncate" aria-hidden="true">{{ stars }}</span>
      <span>{{ t('choreboard.block.allDone') }}</span>
    </component>

    <!-- A later block: one quiet line in its colour. -->
    <component
      :is="isCard ? 'div' : 'button'"
      v-else-if="state === 'later'"
      :type="isCard ? undefined : 'button'"
      class="font-outfit flex w-full items-center gap-2.5 rounded-2xl bg-[var(--chore-tint)] px-4 py-2.5 text-left text-sm font-semibold text-[var(--chore-ink)]"
      :class="meta.colorClass"
      :aria-expanded="isCard ? undefined : expanded ? 'true' : 'false'"
      :aria-label="isCard ? undefined : toggleLabel"
      data-testid="chore-block-later"
      @click="!isCard && (expanded = !expanded)"
    >
      <span class="text-lg" aria-hidden="true">{{ meta.emoji }}</span>
      <span class="min-w-0 flex-1 truncate">
        {{ label }}
        <span v-if="subtitle" class="font-inter text-xs font-medium">{{ subtitle }}</span>
      </span>
      <span class="hidden gap-0.5 text-base sm:inline-flex" aria-hidden="true">
        <span v-for="(g, i) in peek" :key="i">{{ g }}</span>
      </span>
      <span class="font-inter text-xs font-medium whitespace-nowrap">{{ choresText }}</span>
      <svg
        class="h-4 w-4 flex-none transition-transform duration-200"
        :class="expanded ? 'rotate-90' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06L8.26 14.8a.75.75 0 0 1-1.06 0Z"
          clip-rule="evenodd"
        />
      </svg>
    </component>

    <!-- An open block's colour header. -->
    <header
      v-else
      class="font-outfit flex items-center gap-2 bg-[var(--chore-tint)] font-bold text-[var(--chore-ink)]"
      :class="[
        meta.colorClass,
        isCard ? 'rounded-xl px-2.5 py-1.5 text-xs' : 'px-4 py-2.5 text-base',
      ]"
    >
      <span :class="isCard ? 'text-sm' : 'text-xl'" aria-hidden="true">{{ meta.emoji }}</span>
      <span class="min-w-0 flex-1 truncate">
        {{ label }}
        <span v-if="subtitle && !isCard" class="font-inter text-xs font-medium">{{
          subtitle
        }}</span>
      </span>
      <span class="whitespace-nowrap" :class="isCard ? '' : 'font-inter text-xs font-medium'">{{
        countText
      }}</span>
      <span
        v-if="block.isNow && !isCard"
        class="from-primary-500 to-terracotta-400 rounded-full bg-gradient-to-br px-2.5 py-0.5 text-xs font-bold text-white"
        data-testid="chore-now-tag"
        >{{ t('choreboard.now.tag') }}</span
      >
    </header>

    <draggable
      v-if="showRows && canDrag"
      v-model="rowsDraft"
      :item-key="(item: ChoreDayItem) => item.chore.id"
      handle=".drag-handle"
      :animation="prefersReducedMotion ? 0 : 160"
      ghost-class="chore-row-ghost"
      class="flex flex-col"
      :class="isCard ? 'gap-1' : 'gap-1.5 p-2'"
      data-testid="chore-block-rows"
      @change="onRowMove"
    >
      <template #item="{ element: item }">
        <ChoreRow
          :chore="item.chore"
          :member-id="memberId"
          :done="item.done"
          :compact="isCard"
          :can-tick="canTick"
          :can-edit="canEdit"
          :pending="isPending(item.chore.id)"
          draggable
          @toggle="emit('toggle', item.chore.id)"
          @edit="emit('edit', item.chore.id)"
        />
      </template>
    </draggable>
    <div
      v-else-if="showRows"
      class="flex flex-col"
      :class="isCard ? 'gap-1' : 'gap-1.5 p-2'"
      data-testid="chore-block-rows"
    >
      <ChoreRow
        v-for="item in block.chores"
        :key="item.chore.id"
        :chore="item.chore"
        :member-id="memberId"
        :done="item.done"
        :compact="isCard"
        :can-tick="canTick"
        :can-edit="canEdit"
        :pending="isPending(item.chore.id)"
        :selecting="selecting"
        :selected="isSelected(item.chore.id)"
        @toggle="emit('toggle', item.chore.id)"
        @edit="emit('edit', item.chore.id)"
        @select="emit('select', item.chore.id)"
      />
    </div>
  </section>
</template>

<style scoped>
/* Drag placeholder while reordering a chore (the Beanie Lists item ghost: orange ring + lift).
   `--tint-orange-15` has its own dark value in `src/style.css`, so one rule serves both
   themes. (The list ghost names `--tint-orange-12`, which is not defined: recorded, not
   changed here.) */
.chore-row-ghost {
  background: var(--tint-orange-15);
  border-radius: 1rem;
  box-shadow: 0 0 0 2px var(--color-primary-500);
  opacity: 0.9;
}
</style>
