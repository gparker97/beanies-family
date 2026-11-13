<script setup lang="ts">
/**
 * One chore on the choreboard PAGE (#146): its picture, two or three words, and a tick the size
 * of a thumb. Done chores stay put and glow orange, so a child sees what they did. A shared
 * chore names the other beans ("with Juno"): each bean has their own tick.
 *
 * The wall has its own row (`WallJobRow`, which owns the wall's optimistic tick and lock); this
 * one is the page's only. The tick and the edit are intents (`toggle`, `edit`): the page owns
 * the in-flight guard and the store call.
 *
 * A grown-up (`canEdit`) gets a quiet pencil on the row (`chore-row-edit`) as well as the tap on
 * the name, so editing is visible. Kids never see it, and the wall never uses this row.
 *
 * Select mode (`selecting`, a grown-up deleting several chores on a bean's day): the tick
 * becomes a selection checkbox (`chore-row-select`), the name toggles it too, and the pencil and
 * drag handle step aside. A row with no tick at all (`canTick` false, the "Other Days" rows)
 * still selects.
 *
 * Grown-ups reorder a block on a bean's day by the row's drag handle (`draggable`), the same
 * handle a Beanie Lists item row has (`.drag-handle`, `touch-none` so a handle drag does not
 * scroll); the block section owns the drag itself.
 *
 * Dark mode: the resting row is `surface-overlay` (it sits on a raised card), the done row the
 * orange tint whose dark value lives in `--tint-orange-8`, the picture box `surface-hover`. The
 * ticked tick is the Heritage Orange gradient with white ink in both themes (a filled control,
 * CIG slide 9); the resting tick's ring is `line-strong` on dark. The pencil is `ink-faint`,
 * hovering to Heritage Orange / `accent-lift`. A selected checkbox is the same orange gradient
 * as a tick, so selection reads the same in both themes.
 */
import { computed } from 'vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { choreArtSrc, choreEmoji } from '@/constants/choreBlocks';
import { formatNameList, membersByIds } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { Chore } from '@/types/models';

const props = withDefaults(
  defineProps<{
    chore: Chore;
    /** Whose tick this row is (a shared chore has one row per bean). */
    memberId: string;
    done: boolean;
    /** The grown-ups' overview size; the default is the child-sized row. */
    compact?: boolean;
    canTick?: boolean;
    canEdit?: boolean;
    /** This exact tick is in flight. */
    pending?: boolean;
    /** Show the drag handle (a grown-up reordering a block on a bean's day). */
    draggable?: boolean;
    /** Select mode: the tick is a selection checkbox. */
    selecting?: boolean;
    selected?: boolean;
    /** Draw the tick state at all. False for a chore not on today (the "Other Days" rows). */
    showTick?: boolean;
  }>(),
  {
    compact: false,
    canTick: true,
    canEdit: false,
    pending: false,
    draggable: false,
    selecting: false,
    selected: false,
    showTick: true,
  }
);

const emit = defineEmits<{ toggle: []; edit: []; select: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

const card = computed(() => ({
  emoji: choreEmoji(props.chore),
  illustration: choreArtSrc(props.chore.illustration),
}));

/** The OTHER beans on a shared chore, as the roster still knows them. */
const sharedWith = computed(() => {
  const others = (props.chore.assigneeIds ?? []).filter((id) => id !== props.memberId);
  if (!others.length) return '';
  const names = membersByIds(familyStore.members, others).map((m) => m.name);
  return names.length
    ? fillTemplate(t('choreboard.row.with'), { names: formatNameList(names) })
    : '';
});

const tickLabel = computed(() =>
  fillTemplate(t(props.done ? 'choreboard.row.untick' : 'choreboard.row.tick'), {
    chore: props.chore.title,
  })
);
const editLabel = computed(() =>
  fillTemplate(t('choreboard.row.edit'), { chore: props.chore.title })
);

const selectLabel = computed(() =>
  fillTemplate(t('choreboard.row.select'), { chore: props.chore.title })
);

function onName(): void {
  if (props.selecting) emit('select');
  else if (props.canEdit) emit('edit');
}

function onTick(): void {
  if (props.canTick && !props.pending) emit('toggle');
}
</script>

<template>
  <div
    class="flex items-center rounded-2xl transition-colors duration-200"
    :class="[
      done ? 'bg-[var(--tint-orange-8)]' : 'dark:bg-surface-overlay bg-[var(--tint-slate-5)]',
      compact ? 'gap-2 py-1 pr-1.5 pl-1' : 'gap-3 py-2 pr-2 pl-2',
    ]"
    data-testid="chore-row"
    :data-chore-id="chore.id"
    :data-member-id="memberId"
    :data-done="done ? 'true' : 'false'"
  >
    <!-- Drag handle (opt-in), as on a Beanie Lists item row. -->
    <button
      v-if="draggable && !selecting"
      type="button"
      class="drag-handle dark:text-ink-faint hover:text-primary-500 dark:hover:text-accent-lift flex-none cursor-grab touch-none px-0.5 text-base leading-none text-[var(--color-text-muted)] transition-colors active:cursor-grabbing"
      :aria-label="t('lists.detail.dragHandle')"
      data-testid="chore-drag-handle"
    >
      <span aria-hidden="true">⠿</span>
    </button>
    <span
      class="dark:bg-surface-hover flex flex-none items-center justify-center overflow-hidden bg-white"
      :class="compact ? 'h-9 w-9 rounded-xl text-xl' : 'h-13 w-13 rounded-2xl text-3xl'"
      aria-hidden="true"
    >
      <CardArt :card="card" img-class="h-full w-full object-contain" />
    </span>

    <component
      :is="canEdit || selecting ? 'button' : 'span'"
      :type="canEdit || selecting ? 'button' : undefined"
      class="min-w-0 flex-1 text-left"
      :class="
        canEdit || selecting
          ? 'focus-visible:ring-sky-silk-300 rounded-lg focus-visible:ring-2 focus-visible:outline-none'
          : ''
      "
      :aria-label="selecting ? selectLabel : canEdit ? editLabel : undefined"
      :data-testid="selecting ? undefined : canEdit ? 'chore-edit' : undefined"
      @click="onName"
    >
      <span
        class="font-outfit block leading-tight font-semibold break-words"
        :class="[
          compact ? 'text-sm' : 'text-lg',
          done ? 'dark:text-ink-soft text-secondary-400' : 'dark:text-ink text-secondary-500',
        ]"
        >{{ chore.title }}</span
      >
      <span
        v-if="sharedWith"
        class="dark:text-ink-faint text-secondary-400 mt-0.5 block truncate text-xs"
        data-testid="chore-shared-with"
        >{{ sharedWith }}</span
      >
    </component>

    <!-- The quiet pencil: editing made visible (grown-ups only, never in select mode). -->
    <button
      v-if="canEdit && !selecting"
      type="button"
      class="dark:text-ink-faint hover:text-primary-500 dark:hover:text-accent-lift focus-visible:ring-sky-silk-300 -my-1 flex h-11 w-11 flex-none items-center justify-center rounded-xl text-[var(--color-text-muted)] transition-colors focus-visible:ring-2 focus-visible:outline-none"
      :aria-label="editLabel"
      :title="editLabel"
      data-testid="chore-row-edit"
      @click="emit('edit')"
    >
      <svg
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L8.5 18 4 19.5 5.5 15 16.9 3.6Z" />
      </svg>
    </button>

    <!-- Select mode: the tick's place becomes a selection checkbox. -->
    <button
      v-if="selecting"
      type="button"
      role="checkbox"
      class="focus-visible:ring-sky-silk-300 flex flex-none items-center justify-center rounded-lg transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      :class="[
        compact ? 'h-9 w-9' : 'h-11 w-11',
        selected
          ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
          : 'border-secondary-400 dark:border-line-strong dark:bg-surface-raised border-2 bg-white',
      ]"
      :aria-checked="selected ? 'true' : 'false'"
      :aria-label="selectLabel"
      data-testid="chore-row-select"
      @click="emit('select')"
    >
      <svg
        v-if="selected"
        class="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
    <button
      v-else-if="canTick && showTick"
      type="button"
      class="focus-visible:ring-sky-silk-300 flex flex-none items-center justify-center rounded-full transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      :class="[
        compact ? 'h-9 w-9' : 'h-13 w-13',
        done
          ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white shadow-[0_4px_12px_rgba(241,93,34,0.3)]'
          : 'border-secondary-400 dark:border-line-strong dark:bg-surface-raised border-2 bg-white',
        pending ? 'opacity-70' : '',
      ]"
      :aria-pressed="done ? 'true' : 'false'"
      :aria-label="tickLabel"
      :aria-busy="pending ? 'true' : undefined"
      data-testid="chore-tick"
      @click="onTick"
    >
      <svg
        v-if="done"
        :class="compact ? 'h-4 w-4' : 'h-6 w-6'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
    <span
      v-else-if="showTick"
      class="flex flex-none items-center justify-center rounded-full"
      :class="[
        compact ? 'h-7 w-7' : 'h-9 w-9',
        done
          ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
          : 'border-secondary-400 dark:border-line-strong border-2',
      ]"
      aria-hidden="true"
    >
      <svg
        v-if="done"
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  </div>
</template>
