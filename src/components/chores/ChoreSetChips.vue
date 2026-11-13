<script setup lang="ts">
/**
 * "Add a Set of Chores" (#146): a chip per suggestion set, and the read-only preview of the one
 * tapped (one at a time; the chip again, its close control or Escape collapses it). The ONE copy,
 * in the Add Chores sheet and in a bean's chore list.
 *
 * The host says which chores a set would add (`preview`: each draft with whether its list
 * already has it, same title and same block, which is dimmed and left out of the count), which
 * sets are already on (`onKeys`, a ✓ chip), and whether an on set can be taken back
 * (`removable`, the sheet's "Remove from List"). The primary action emits `add`, or `remove` for
 * a set on the list; the preview closes after either. It lives inside its host's `BaseModal`
 * body, which unmounts when the sheet closes, so its Escape token never outlives the sheet.
 *
 * Dark mode: chips and the preview are `surface-overlay`; an open or added chip is the orange
 * tint with an `accent-lift` edge; dimmed rows and counts are `ink-faint`, never an opacity.
 */
import { computed, ref } from 'vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useEscapeClose } from '@/composables/useEscapeClose';
import {
  CHORE_STARTER_SETS,
  choreStarterSet,
  type ChoreStarterSet,
  type ChoreStarterSetKey,
  type StarterChoreDraft,
} from '@/constants/choreStarterSets';
import { CHORE_BLOCK_META, choreDaysLabel } from '@/constants/choreBlocks';
import { fillTemplate } from '@/utils/fillTemplate';

const props = withDefaults(
  defineProps<{
    /** What a set would add: each of its drafts, and whether the list already has it. */
    preview: (key: ChoreStarterSetKey) => { draft: StarterChoreDraft; dup: boolean }[];
    /** Sets shown as on (✓). */
    onKeys: readonly ChoreStarterSetKey[];
    /** An on set offers "Remove from List" (the sheet); otherwise its Add is simply 0. */
    removable?: boolean;
    /** A write is in flight: the primary action waits. */
    busy?: boolean;
  }>(),
  { removable: false, busy: false }
);

const emit = defineEmits<{ add: [key: ChoreStarterSetKey]; remove: [key: ChoreStarterSetKey] }>();

const { t } = useTranslation();

/** The set whose preview is open, or `null`. */
const previewKey = ref<ChoreStarterSetKey | null>(null);

function closePreview(): void {
  previewKey.value = null;
}

function toggle(key: ChoreStarterSetKey): void {
  previewKey.value = previewKey.value === key ? null : key;
}

useEscapeClose(
  computed(() => previewKey.value !== null),
  closePreview
);

const isOn = (key: ChoreStarterSetKey) => props.onKeys.includes(key);

const choresCount = (s: ChoreStarterSet) =>
  fillTemplate(
    t(s.chores.length === 1 ? 'choreboard.block.chores.one' : 'choreboard.block.chores.other'),
    { count: s.chores.length }
  );

const open = computed(() => {
  const key = previewKey.value;
  const set = key ? choreStarterSet(key) : undefined;
  if (!key || !set) return null;
  // `preview` reads the host's list, so the duplicate marks follow its edits.
  const rows = props.preview(key);
  const count = rows.filter((r) => !r.dup).length;
  return { key, set, rows, count, takeBack: props.removable && isOn(key) };
});

const addLabel = computed(() =>
  open.value
    ? fillTemplate(
        t(
          open.value.count === 1
            ? 'choreboard.add.previewAdd.one'
            : 'choreboard.add.previewAdd.other'
        ),
        { count: open.value.count }
      )
    : ''
);

const daysTag = (d: StarterChoreDraft) => choreDaysLabel(d.days, t);

function onAdd(): void {
  const p = open.value;
  if (!p || p.takeBack || p.count === 0 || props.busy) return;
  emit('add', p.key);
  closePreview();
}

function onRemove(): void {
  const p = open.value;
  if (!p || !p.takeBack) return;
  emit('remove', p.key);
  closePreview();
}
</script>

<template>
  <FormFieldGroup :label="t('choreboard.add.sets')">
    <div class="flex flex-wrap gap-2" role="group">
      <button
        v-for="s in CHORE_STARTER_SETS"
        :key="s.key"
        type="button"
        class="font-outfit focus-visible:ring-sky-silk-300 flex min-h-11 items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none"
        :class="
          isOn(s.key) || previewKey === s.key
            ? 'border-primary-500 dark:border-accent-lift text-secondary-500 dark:text-ink bg-[var(--tint-orange-8)]'
            : 'dark:bg-surface-overlay dark:text-ink text-secondary-500 border-transparent bg-[var(--tint-slate-5)]'
        "
        :aria-expanded="previewKey === s.key ? 'true' : 'false'"
        data-testid="chore-suggest-chip"
        :data-set="s.key"
        :data-on="isOn(s.key) ? 'true' : 'false'"
        @click="toggle(s.key)"
      >
        <span aria-hidden="true">{{ isOn(s.key) ? '✓' : s.emoji }}</span>
        {{ t(s.nameKey) }}
        <span class="dark:text-ink-faint text-secondary-400 font-inter text-xs font-medium">{{
          choresCount(s)
        }}</span>
      </button>
    </div>

    <!-- The open set's preview: read-only, one primary action. -->
    <section
      v-if="open"
      class="dark:bg-surface-overlay mt-2 rounded-2xl bg-[var(--tint-slate-5)] p-3"
      data-testid="chore-set-preview"
      :data-set="open.key"
    >
      <div class="mb-2 flex items-center gap-2">
        <span class="text-xl" aria-hidden="true">{{ open.set.emoji }}</span>
        <h3 class="font-outfit dark:text-ink text-secondary-500 min-w-0 flex-1 text-sm font-bold">
          {{ t(open.set.nameKey) }}
        </h3>
        <button
          type="button"
          class="dark:text-ink-faint dark:hover:text-accent-lift flex h-11 w-11 flex-none items-center justify-center text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary-500)]"
          :aria-label="t('choreboard.add.previewClose')"
          :title="t('choreboard.add.previewClose')"
          data-testid="chore-set-preview-close"
          @click="closePreview"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <ul class="flex flex-col gap-1">
        <li
          v-for="(p, i) in open.rows"
          :key="i"
          class="flex items-center gap-2 text-sm"
          data-testid="chore-set-preview-row"
          :data-dup="p.dup ? 'true' : 'false'"
        >
          <span class="w-6 flex-none text-center text-lg" aria-hidden="true">{{
            p.draft.emoji
          }}</span>
          <span
            class="min-w-0 flex-1 truncate"
            :class="
              p.dup ? 'dark:text-ink-faint text-secondary-400' : 'dark:text-ink text-secondary-500'
            "
            >{{ p.draft.title }}</span
          >
          <span v-if="p.dup" class="dark:text-ink-faint text-secondary-400 text-xs italic">{{
            t('choreboard.add.previewDup')
          }}</span>
          <span v-if="daysTag(p.draft)" class="dark:text-ink-soft text-secondary-400 text-xs">{{
            daysTag(p.draft)
          }}</span>
          <span
            class="font-outfit flex-none rounded-full bg-[var(--chore-tint)] px-2 py-0.5 text-xs font-semibold text-[var(--chore-ink)]"
            :class="CHORE_BLOCK_META[p.draft.block].colorClass"
          >
            <span aria-hidden="true">{{ CHORE_BLOCK_META[p.draft.block].emoji }}</span>
            {{ t(CHORE_BLOCK_META[p.draft.block].labelKey) }}
          </span>
        </li>
      </ul>
      <button
        v-if="open.takeBack"
        type="button"
        class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 mt-3 min-h-11 w-full rounded-xl border border-[var(--color-border-strong)] bg-white py-2 text-sm font-bold focus-visible:ring-2 focus-visible:outline-none"
        data-testid="chore-set-preview-remove"
        @click="onRemove"
      >
        {{ t('choreboard.add.previewRemove') }}
      </button>
      <button
        v-else
        type="button"
        class="font-outfit focus-visible:ring-sky-silk-300 mt-3 min-h-11 w-full rounded-xl py-2 text-sm font-bold focus-visible:ring-2 focus-visible:outline-none"
        :class="
          open.count > 0
            ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white'
            : 'dark:bg-surface-hover dark:text-ink-soft text-secondary-500 cursor-not-allowed bg-[var(--tint-slate-10)]'
        "
        :disabled="open.count === 0 || busy"
        :aria-busy="busy ? 'true' : undefined"
        data-testid="chore-set-preview-add"
        @click="onAdd"
      >
        {{ addLabel }}
      </button>
    </section>
  </FormFieldGroup>
</template>
