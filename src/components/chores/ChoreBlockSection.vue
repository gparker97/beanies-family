<script setup lang="ts">
/**
 * One time-of-day block of a bean's day (#146), in its block colour: the tick view of
 * `?bean=<id>`. (The home card draws its blocks with `ChoreBlockSummary`.)
 * Every state comes from the ONE read model (`beanChoreDay` → `ChoreDayBlock`), nothing here
 * decides "done" or "now":
 *
 *  - open:    the colour header (with the Heritage Orange ring and "Now" tag when it is the block
 *             happening now) and its chores, tickable. On a bean's day every block opens this way
 *             (`open`), for kids and grown-ups alike; the header folds it (`collapse`);
 *  - later:   a folded block: one quiet line in the block colour (tap to open it again). The
 *             fold is this page visit's only, never saved;
 *  - done:    every chore ticked. With `celebrate` the all-done `CelebrationBanner` with one star
 *             per chore; without, a one-line "All Done" strip with its stars. Either can reopen
 *             its chores, so a tick made by mistake can be undone. The celebration itself is the
 *             store's (once per bean, block and day); this draws the banner, in its celebrating
 *             form while the celebration plays on it (`choreBannerCelebration`), and keeps the
 *             ticked rows a moment longer while the stars burst from the last tick
 *             (`choreBlockHeld`).
 *
 * A grown-up (`canEdit`) can tap a chore's name (`edit`); the page opens the bean's chore list,
 * where chores are edited and reordered (`ChoreBeanEditor`). This section only ticks: `toggle`
 * carries the celebration's anchor (this block and the tick), measured at the tap.
 *
 * `reveal()` (exposed) opens a folded block and brings it into view with focus: the day's
 * "Today" summary calls it when a row is tapped.
 *
 * Colours: the block's tint and ink come from `.chore-block-*` (`src/style.css`), which holds
 * their dark partners. The done strip is the orange tint with `primary-700` / `accent-lift`
 * ink. The banner is the fixed brand gradient with white ink in both themes.
 */
import { computed, nextTick, ref } from 'vue';
import ChoreRow from '@/components/chores/ChoreRow.vue';
import CelebrationBanner from '@/components/ui/CelebrationBanner.vue';
import { choreBannerCelebration, choreBlockHeld } from '@/composables/useCelebration';
import { useTranslation } from '@/composables/useTranslation';
import { CHORE_BLOCK_META, choreBlockHint, choreEmoji } from '@/constants/choreBlocks';
import { fillTemplate } from '@/utils/fillTemplate';
import { choreCelebrationAnchor, type ChoreCelebrationAnchor } from '@/utils/choreCelebration';
import type { ChoreDayBlock } from '@/utils/chores';
import type { ChoreBlockStarts } from '@/types/models';

const props = withDefaults(
  defineProps<{
    block: ChoreDayBlock;
    memberId: string;
    /** The bean's first name, for the banner's "Nice work, {name}." */
    beanName: string;
    /** Open with its chores showing (every block on a bean's day). False starts folded. */
    open?: boolean;
    /** A finished block draws the big banner (true) or the one-line strip (false). */
    celebrate?: boolean;
    starts: ChoreBlockStarts;
    canTick?: boolean;
    canEdit?: boolean;
    isPending?: (choreId: string) => boolean;
  }>(),
  {
    open: true,
    celebrate: false,
    canTick: true,
    canEdit: false,
    isPending: () => false,
  }
);

const emit = defineEmits<{
  toggle: [choreId: string, anchor: ChoreCelebrationAnchor | null];
  edit: [choreId: string];
}>();

const { t } = useTranslation();

/** Folded by its header (or never opened): this page visit only. */
const collapsed = ref(!props.open);
/** A done strip or the banner opened by hand to see its chores. */
const expanded = ref(false);

const meta = computed(() => CHORE_BLOCK_META[props.block.block]);
const label = computed(() => t(meta.value.labelKey));

/** The last tick just finished this block: its rows stay while the stars burst out. */
const held = computed(() => choreBlockHeld(props.memberId, props.block.block));
const bannerCelebration = computed(() => choreBannerCelebration(props.memberId, props.block.block));

type State = 'open' | 'later' | 'done' | 'banner';
const state = computed<State>(() => {
  if (held.value) return 'open';
  if (props.block.allDone) return props.celebrate ? 'banner' : 'done';
  return collapsed.value ? 'later' : 'open';
});
const showRows = computed(
  () => state.value === 'open' || (state.value !== 'later' && expanded.value)
);

const subtitle = computed(() => choreBlockHint(props.block, props.starts, t));

const left = computed(() => props.block.total - props.block.done);
const countText = computed(() =>
  props.block.ended
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
/** The fold's label: "Hide Morning chores" on an open header, "Show ..." on a folded line. */
const foldLabel = computed(() =>
  fillTemplate(
    t(state.value === 'open' ? 'choreboard.block.collapse' : 'choreboard.block.expand'),
    {
      block: label.value,
    }
  )
);
/** The done strip's label (it opens the chores of a finished block). */
const toggleLabel = computed(() =>
  fillTemplate(t(expanded.value ? 'choreboard.block.collapse' : 'choreboard.block.expand'), {
    block: label.value,
  })
);

const root = ref<HTMLElement | null>(null);

/** A tick: the intent, and where the celebration would play if this tick finishes the block. */
function onToggle(choreId: string): void {
  const el = root.value;
  const tick = el?.querySelector<HTMLElement>(
    `[data-chore-id="${CSS.escape(choreId)}"] [data-testid="chore-tick"]`
  );
  emit('toggle', choreId, el ? choreCelebrationAnchor(el, tick ?? null) : null);
}

/** Open this block (a folded line, a done strip, a banner) and bring it into view with focus. */
function reveal(): void {
  if (state.value === 'later') collapsed.value = false;
  else if (state.value !== 'open') expanded.value = true;
  void nextTick(() => {
    const el = root.value;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  });
}

defineExpose({ reveal });
</script>

<template>
  <section
    ref="root"
    tabindex="-1"
    class="flex scroll-mt-4 flex-col gap-2 focus:outline-none"
    :class="[
      state === 'open'
        ? 'dark:bg-surface-raised dark:border-line overflow-hidden rounded-3xl bg-white shadow-[var(--card-shadow)] dark:border'
        : '',
      state === 'open' && block.isNow
        ? 'ring-primary-500 shadow-[0_10px_28px_rgba(241,93,34,0.16)] ring-2'
        : '',
    ]"
    data-testid="chore-block"
    :data-block="block.block"
    :data-state="state"
    :data-now="block.isNow ? 'true' : 'false'"
  >
    <!-- The all-done banner: the block happening now (or Anytime). -->
    <template v-if="state === 'banner'">
      <CelebrationBanner
        :title="bannerTitle"
        :body="bannerBody"
        :image-alt="t('choreboard.done.imageAlt')"
        :action-label="t(expanded ? 'choreboard.block.hideChores' : 'choreboard.block.showChores')"
        :stars="block.total"
        :celebration="bannerCelebration"
        data-testid="chore-done-banner"
        @action="expanded = !expanded"
      />
    </template>

    <!-- The one-line "All Done" strip, with its stars. -->
    <button
      v-else-if="state === 'done'"
      type="button"
      class="font-outfit text-primary-700 dark:text-accent-lift flex w-full items-center gap-2 rounded-2xl bg-[var(--tint-orange-8)] px-4 py-3 text-left text-sm font-bold"
      :aria-expanded="expanded ? 'true' : 'false'"
      :aria-label="toggleLabel"
      data-testid="chore-done-strip"
      @click="expanded = !expanded"
    >
      <span aria-hidden="true">{{ meta.emoji }}</span>
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <span class="truncate" aria-hidden="true">{{ stars }}</span>
      <span>{{ t('choreboard.block.allDone') }}</span>
    </button>

    <!-- A folded block: one quiet line in its colour. -->
    <button
      v-else-if="state === 'later'"
      type="button"
      class="font-outfit flex w-full items-center gap-2.5 rounded-2xl bg-[var(--chore-tint)] px-4 py-2.5 text-left text-sm font-semibold text-[var(--chore-ink)]"
      :class="meta.colorClass"
      aria-expanded="false"
      :aria-label="foldLabel"
      data-testid="chore-block-later"
      @click="collapsed = false"
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
        class="h-4 w-4 flex-none transition-transform duration-200 motion-reduce:transition-none"
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
    </button>

    <!--
      An open block's colour header, which folds it. The block happening now keeps the larger
      header (with its ring and Now tag above), so it stays the biggest thing on the day.
    -->
    <button
      v-else
      type="button"
      class="font-outfit focus-visible:ring-sky-silk-300 flex w-full items-center gap-2 bg-[var(--chore-tint)] px-4 text-left font-bold text-[var(--chore-ink)] focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      :class="[meta.colorClass, block.isNow ? 'py-2.5 text-base' : 'py-2 text-sm']"
      aria-expanded="true"
      :aria-label="foldLabel"
      data-testid="chore-block-header"
      @click="collapsed = true"
    >
      <span :class="block.isNow ? 'text-xl' : 'text-lg'" aria-hidden="true">{{ meta.emoji }}</span>
      <span class="min-w-0 flex-1 truncate">
        {{ label }}
        <span v-if="subtitle" class="font-inter text-xs font-medium">{{ subtitle }}</span>
      </span>
      <span class="font-inter text-xs font-medium whitespace-nowrap">{{ countText }}</span>
      <span
        v-if="block.isNow"
        class="from-primary-500 to-terracotta-400 rounded-full bg-gradient-to-br px-2.5 py-0.5 text-xs font-bold text-white"
        data-testid="chore-now-tag"
        >{{ t('choreboard.now.tag') }}</span
      >
      <svg
        class="h-4 w-4 flex-none rotate-90"
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
    </button>

    <div v-if="showRows" class="flex flex-col gap-1.5 p-2" data-testid="chore-block-rows">
      <ChoreRow
        v-for="item in block.chores"
        :key="item.chore.id"
        :chore="item.chore"
        :member-id="memberId"
        :done="item.done"
        :can-tick="canTick"
        :can-edit="canEdit"
        :pending="isPending(item.chore.id)"
        @toggle="onToggle(item.chore.id)"
        @edit="emit('edit', item.chore.id)"
      />
    </div>
  </section>
</template>
