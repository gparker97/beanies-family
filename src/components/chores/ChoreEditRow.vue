<script setup lang="ts">
/**
 * One chore row in a chore list being edited (#146): the ONE row of the Add Chores sheet (draft
 * rows) and of a bean's chore list (stored chores). Inspired by a Beanie Lists item row: picture
 * tile, inline title, a quiet days control, the time-of-day pill and the ✕.
 *
 * The row decides nothing and writes nothing: every change is an intent for its host
 * (`commit`, `empty`, `cancel`, `time`, `picture`, `days`, `remove`, `chooser`), and the host
 * answers it (a draft edit, or a store write). Which chooser is open (time tiles, picture,
 * days) is the list's (`chooser`), so one is open at a time across the list.
 *
 * The title edit is the row's own, the list-entry convention:
 *  - focus starts an edit; Enter or blur ends it. A non-empty title is `commit`ted (Enter says
 *    so, so a host can open the next row); an empty one is `empty` (the host drops a new row; an
 *    existing row simply shows its title again);
 *  - Escape cancels (the row shows its title again; the host drops a new row). It is owned here,
 *    through `useEscapeClose`, so it sits above whatever chooser or sheet is open;
 *  - an Enter that confirms an IME composition is typing (`AutoGrowTextarea`);
 *  - while editing, every keystroke is reported (`typing`), so a host can count and send the
 *    title being typed (the sheet's Add button) without waiting for a commit;
 *  - a row removed mid-edit (the sheet closing) commits a changed, non-empty title, so typed
 *    text is never lost;
 *  - the row's own ✕ DISCARDS an edit in progress (never commits it), whichever comes first: the
 *    ✕ keeps the field's focus on a press, and a blur towards the ✕ is not a commit. So a
 *    half-typed rename never lands on a chore that is being removed.
 * The field shows the edit while editing and the host's title otherwise, so a write that fails
 * shows the stored title again with nothing left behind. The title wraps to two lines and more
 * rather than truncating, so a normal chore name stays readable on a phone.
 *
 * Days: a chore that repeats every day shows nothing but a small calendar button; any other
 * days show their quiet tag ("School Days", "Weekends", "Mon, Wed") and the tag IS the control.
 *
 * Every control is a 44px hit area; the visible pill, tile and glyph sit inside it.
 *
 * Dark mode: the row is `surface-overlay` (it sits on the sheet's raised panel), the picture
 * tile `surface-hover`, the focused title `surface-raised` with a `line-strong` ring; the
 * time pill and tiles paint `--chore-tint` / `--chore-ink` (`.chore-block-*`, dark partners in
 * `src/style.css`); the days tag, note and quiet glyphs are `ink-faint`, hovering to
 * `accent-lift`.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import AutoGrowTextarea from '@/components/ui/AutoGrowTextarea.vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import ChorePicturePicker from '@/components/chores/ChorePicturePicker.vue';
import ChoreDaysChooser from '@/components/chores/ChoreDaysChooser.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEscapeClose } from '@/composables/useEscapeClose';
import {
  CHORE_BLOCK_META,
  CHORE_TITLE_MAX,
  choreArtSrc,
  choreDaysLabel,
} from '@/constants/choreBlocks';
import { CHORE_BLOCKS } from '@/utils/chores';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreEditChooser, ChoreEditItem } from '@/components/chores/choreEditItem';
import type { ChoreBlock } from '@/types/models';

const props = withDefaults(
  defineProps<{
    item: ChoreEditItem;
    /** The chooser open on THIS row, or `null`. */
    chooser?: ChoreEditChooser | null;
  }>(),
  { chooser: null }
);

const emit = defineEmits<{
  commit: [title: string, enter: boolean];
  /** The text being typed, on every change while editing. */
  typing: [text: string];
  empty: [];
  cancel: [];
  chooser: [kind: ChoreEditChooser];
  time: [block: ChoreBlock];
  picture: [picture: { emoji: string; illustration: string }];
  days: [days: number[], preset: boolean];
  remove: [];
}>();

const { t } = useTranslation();

// ── The title edit ───────────────────────────────────────────────────────────

const field = ref<InstanceType<typeof AutoGrowTextarea> | null>(null);
const removeButton = ref<HTMLButtonElement | null>(null);
const editing = ref(false);
const text = ref('');

function onInput(value: string): void {
  text.value = value;
  if (editing.value) emit('typing', value);
}

const textarea = () =>
  (field.value?.$el as HTMLElement | undefined)?.querySelector('textarea') ?? null;

function startEdit(): void {
  if (editing.value) return;
  text.value = props.item.title;
  editing.value = true;
}

/** End the edit, keeping the text. Idempotent, so the blur after an Enter is harmless. */
function endEdit(enter: boolean): void {
  if (!editing.value) return;
  editing.value = false;
  const title = text.value.trim();
  if (title) emit('commit', title, enter);
  else emit('empty');
}

function onEnter(): void {
  endEdit(true);
  // `editing` is already off, so this blur commits nothing twice.
  textarea()?.blur();
}

/** A blur ends the edit, except one towards this row's ✕, which discards it (see `onRemove`). */
function onBlur(e: FocusEvent): void {
  if (removeButton.value && e.relatedTarget === removeButton.value) discardEdit();
  else endEdit(false);
}

function cancelEdit(): void {
  if (!editing.value) return;
  editing.value = false;
  emit('cancel');
  textarea()?.blur();
}

/** Drop the edit without a word: the row is about to go. */
function discardEdit(): void {
  editing.value = false;
}

/** The ✕: an edit in progress is discarded first, so it can never be committed afterwards. */
function onRemove(): void {
  discardEdit();
  textarea()?.blur();
  emit('remove');
}

useEscapeClose(editing, cancelEdit);

// A focused field removed from the DOM does not reliably fire blur: keep a changed title.
onBeforeUnmount(() => {
  if (!editing.value) return;
  editing.value = false;
  const title = text.value.trim();
  if (title && title !== props.item.title) emit('commit', title, false);
});

function focus(): void {
  field.value?.focus();
}
defineExpose({ focus });

// ── Labels ───────────────────────────────────────────────────────────────────

const name = computed(() => props.item.title.trim() || t('choreboard.starter.newPlaceholder'));
const meta = computed(() => CHORE_BLOCK_META[props.item.block]);
const blockLabel = (b: ChoreBlock) => t(CHORE_BLOCK_META[b].labelKey);

/** The quiet days tag, or '' for every day. */
const daysTag = computed(() => choreDaysLabel(props.item.days, t));
const daysAria = computed(() =>
  fillTemplate(t('choreboard.editor.daysAria'), {
    chore: name.value,
    days: daysTag.value || t('choreboard.form.days.every'),
  })
);
const timeAria = computed(() =>
  fillTemplate(t('choreboard.add.timeAria'), {
    chore: name.value,
    block: blockLabel(props.item.block),
  })
);
const removeAria = computed(() =>
  fillTemplate(t('choreboard.starter.removeAria'), { chore: name.value })
);

/** Hover and focus for the quiet glyph buttons (✕, calendar, drag handle). */
const QUIET =
  'dark:text-ink-faint hover:text-primary-500 dark:hover:text-accent-lift focus-visible:ring-sky-silk-300 text-[var(--color-text-muted)] transition-colors focus-visible:ring-2 focus-visible:outline-none';
</script>

<template>
  <li data-testid="chore-draft-row" :data-block="item.block" v-bind="item.attrs">
    <div
      class="dark:bg-surface-overlay flex items-center rounded-xl bg-[var(--tint-slate-5)] py-0.5 pr-0.5 pl-1 text-sm"
    >
      <!-- The drag handle (a stored chore, reordered within its block), as on a list item row. -->
      <button
        v-if="item.draggable"
        type="button"
        class="drag-handle flex h-11 w-6 flex-none cursor-grab touch-none items-center justify-center rounded-lg text-base leading-none active:cursor-grabbing"
        :class="QUIET"
        :aria-label="t('lists.detail.dragHandle')"
        data-testid="chore-drag-handle"
      >
        <span aria-hidden="true">⠿</span>
      </button>

      <button
        type="button"
        class="focus-visible:ring-sky-silk-300 flex h-11 w-11 flex-none items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:outline-none"
        :aria-label="fillTemplate(t('choreboard.starter.pictureAria'), { chore: name })"
        :aria-expanded="chooser === 'picture' ? 'true' : 'false'"
        data-testid="chore-draft-picture"
        @click="emit('chooser', 'picture')"
      >
        <span
          class="dark:bg-surface-hover flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white text-xl"
        >
          <CardArt
            :card="{ emoji: item.emoji, illustration: choreArtSrc(item.illustration) }"
            img-class="h-full w-full object-contain"
          />
        </span>
      </button>

      <div class="min-w-0 flex-1 py-1 pl-0.5">
        <AutoGrowTextarea
          ref="field"
          :model-value="editing ? text : item.title"
          wrapper-class="w-full text-sm leading-snug"
          single-line
          enterkeyhint="done"
          :maxlength="CHORE_TITLE_MAX"
          :placeholder="t('choreboard.starter.newPlaceholder')"
          :aria-label="fillTemplate(t('choreboard.starter.renameAria'), { chore: name })"
          class="dark:text-ink dark:placeholder:text-ink-faint text-secondary-500 placeholder:text-secondary-400 dark:focus:bg-surface-raised dark:focus:ring-line-strong w-full rounded-lg border-transparent bg-transparent focus:bg-white focus:ring-1 focus:ring-[var(--color-border-strong)] focus:outline-none"
          data-testid="chore-draft-title"
          @update:model-value="onInput"
          @focus="startEdit"
          @enter="onEnter"
          @blur="onBlur"
        />
        <div v-if="daysTag || item.note" class="flex flex-wrap items-center gap-x-2 px-1">
          <button
            v-if="daysTag"
            type="button"
            class="font-outfit dark:text-ink-faint dark:hover:text-accent-lift hover:text-primary-500 focus-visible:ring-sky-silk-300 text-secondary-400 inline-flex min-h-7 items-center rounded-md text-xs font-semibold underline decoration-dotted underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="daysAria"
            :aria-expanded="chooser === 'days' ? 'true' : 'false'"
            data-testid="chore-draft-days"
            @click="emit('chooser', 'days')"
          >
            {{ daysTag }}
          </button>
          <span
            v-if="item.note"
            class="dark:text-ink-faint text-secondary-400 text-xs"
            data-testid="chore-draft-note"
            >{{ item.note }}</span
          >
        </div>
      </div>

      <!-- Every day: one quiet calendar button opens the days chooser. -->
      <button
        v-if="!daysTag"
        type="button"
        class="flex h-11 w-11 flex-none items-center justify-center rounded-xl"
        :class="QUIET"
        :aria-label="daysAria"
        :title="daysAria"
        :aria-expanded="chooser === 'days' ? 'true' : 'false'"
        data-testid="chore-draft-days-pick"
        @click="emit('chooser', 'days')"
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
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M8 3v4M16 3v4M3.5 10h17" />
        </svg>
      </button>

      <button
        type="button"
        class="focus-visible:ring-sky-silk-300 flex h-11 min-w-11 flex-none items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
        :aria-label="timeAria"
        :aria-expanded="chooser === 'time' ? 'true' : 'false'"
        data-testid="chore-draft-time"
        :data-block="item.block"
        @click="emit('chooser', 'time')"
      >
        <span
          class="font-outfit flex h-8 items-center gap-1 rounded-full bg-[var(--chore-tint)] px-2 text-xs font-semibold text-[var(--chore-ink)]"
          :class="meta.colorClass"
        >
          <span aria-hidden="true">{{ meta.emoji }}</span>
          <span class="hidden sm:inline">{{ blockLabel(item.block) }}</span>
        </span>
      </button>

      <!-- The list item row's remove control, with the chore's name. -->
      <!-- `pointerdown.prevent` keeps the field's focus, so its blur cannot commit first. -->
      <button
        ref="removeButton"
        type="button"
        class="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-xs"
        :class="QUIET"
        :aria-label="removeAria"
        :title="removeAria"
        data-testid="chore-draft-remove"
        @pointerdown.prevent
        @click="onRemove"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>

    <!-- The time chooser: the four block tiles, compact. -->
    <div
      v-if="chooser === 'time'"
      class="mt-1.5 grid grid-cols-4 gap-1.5"
      role="group"
      :aria-label="timeAria"
      data-testid="chore-draft-time-choices"
    >
      <button
        v-for="b in CHORE_BLOCKS"
        :key="b"
        type="button"
        class="font-outfit focus-visible:ring-sky-silk-300 flex min-h-11 flex-col items-center justify-center rounded-xl border-2 bg-[var(--chore-tint)] px-1 py-1.5 text-xs font-bold text-[var(--chore-ink)] transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none"
        :class="[
          CHORE_BLOCK_META[b].colorClass,
          item.block === b ? 'border-primary-500 dark:border-accent-lift' : 'border-transparent',
        ]"
        :aria-pressed="item.block === b ? 'true' : 'false'"
        :data-block="b"
        @click="emit('time', b)"
      >
        <span class="text-lg leading-tight" aria-hidden="true">{{
          CHORE_BLOCK_META[b].emoji
        }}</span>
        {{ blockLabel(b) }}
      </button>
    </div>

    <div
      v-if="chooser === 'picture'"
      class="dark:bg-surface-overlay mt-1.5 rounded-xl bg-[var(--tint-slate-5)] p-2.5"
    >
      <ChorePicturePicker
        :emoji="item.emoji"
        :illustration="item.illustration ?? ''"
        @pick="emit('picture', $event)"
      />
    </div>

    <ChoreDaysChooser
      v-if="chooser === 'days'"
      class="mt-1.5"
      :days="item.days"
      :label="daysAria"
      @pick="(days, preset) => emit('days', days, preset)"
    />
  </li>
</template>
