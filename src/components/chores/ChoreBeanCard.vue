<script setup lang="ts">
/**
 * A bean's card on the choreboard home (#146), "four segments": the header (avatar, name, "5 left
 * today", the day's "5 of 11", and a grown-up's Edit Chores and Copy), then one
 * `ChoreBlockSummary` row per time of day the bean has chores in today, in day order. The block
 * happening now is open with its tickable rows (unless it is finished); any other row opens on a
 * tap, one at a time beside Now. The header opens the bean's day.
 *
 * A bean with chores on other days only keeps the header with "No chores today". A bean with no
 * chores at all is a slim row with Add Chores (grown-ups), which opens their chore list
 * (`edit-chores`, the page's `ChoreBeanEditor`), as do Edit Chores and a chore's name.
 *
 * Reads only the one read model (`BeanChoreDay`); ticks and edits are intents for the page.
 * Dark mode: the card is `surface-raised` with a `line` edge; text is `ink` / `ink-faint`;
 * accent text pairs with `accent-lift`.
 */
import { computed, ref } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ChoreBlockSummary from '@/components/chores/ChoreBlockSummary.vue';
import ChoreRow from '@/components/chores/ChoreRow.vue';
import { choreBlockHeld } from '@/composables/useCelebration';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { firstName } from '@/utils/assignees';
import type { BeanChoreDay, ChoreDayBlock } from '@/utils/chores';
import {
  choreTickAnchor,
  choreTickSelector,
  type ChoreCelebrationAnchor,
} from '@/utils/choreCelebration';
import type { ChoreBlock, ChoreBlockStarts, FamilyMember } from '@/types/models';

const props = withDefaults(
  defineProps<{
    member: FamilyMember;
    /** Today's read model; not needed for the slim row (`hasAnyChores` false). */
    day?: BeanChoreDay;
    /** The bean has at least one chore on some day (false draws the slim row). */
    hasAnyChores: boolean;
    starts: ChoreBlockStarts;
    canTick?: boolean;
    canEdit?: boolean;
    isPending?: (choreId: string) => boolean;
  }>(),
  { day: () => ({ blocks: [], left: 0 }), canTick: true, canEdit: false, isPending: () => false }
);

const emit = defineEmits<{
  /** A tick, with where the all-done celebration plays if it finishes the block (#146). */
  toggle: [choreId: string, anchor: ChoreCelebrationAnchor | null];
  /** Open the bean's chore list. */
  'edit-chores': [];
  open: [];
  copy: [];
}>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

const total = computed(() => props.day.blocks.reduce((n, b) => n + b.total, 0));
const done = computed(() => total.value - props.day.left);

/** The blocks with chores today, in day order (morning, afternoon, evening, anytime). */
const blocks = computed(() => props.day.blocks.filter((b) => b.total > 0));

/**
 * The Now block opens by default while it has chores to do; a tap folds it. Folding is kept PER
 * BLOCK, so when the clock moves on, the newly current block opens even if the last one was
 * folded.
 */
const folded = ref<ReadonlySet<ChoreBlock>>(new Set());
/** The one other block opened by a tap. */
const opened = ref<ChoreBlock | null>(null);

/**
 * The Now block opens itself while it has chores to do, and for the moment after its last tick
 * while the celebration's stars burst from that tick (`choreBlockHeld`, #146).
 */
const nowOpensItself = (b: ChoreDayBlock) =>
  b.isNow && (!b.allDone || choreBlockHeld(props.member.id, b.block));

function isOpen(b: ChoreDayBlock): boolean {
  return nowOpensItself(b) ? !folded.value.has(b.block) : opened.value === b.block;
}

function onActivate(b: ChoreDayBlock): void {
  if (nowOpensItself(b)) {
    const next = new Set(folded.value);
    if (next.has(b.block)) next.delete(b.block);
    else next.add(b.block);
    folded.value = next;
  } else {
    opened.value = opened.value === b.block ? null : b.block;
  }
}

const card = ref<HTMLElement | null>(null);

/** The block's summary row is the celebration's anchor; the card has no banner of its own. */
function onToggle(block: ChoreBlock, choreId: string): void {
  const row = card.value?.querySelector<HTMLElement>(
    `[data-testid="chore-summary"][data-block="${block}"]`
  );
  emit('toggle', choreId, choreTickAnchor(row, choreTickSelector(choreId)));
}

const name = computed(() => props.member.name);
const first = computed(() => firstName(props.member.name));

const subline = computed(() => {
  if (total.value === 0) return t('choreboard.card.none');
  if (props.day.left === 0) return t('choreboard.card.allDone');
  return fillTemplate(
    t(props.day.left === 1 ? 'choreboard.card.left.one' : 'choreboard.card.left.other'),
    { count: props.day.left }
  );
});
</script>

<template>
  <!-- ═══ A bean with no chores at all: one slim row ═══ -->
  <div
    v-if="!hasAnyChores"
    class="dark:bg-surface-raised dark:border-line flex min-w-0 items-center gap-2.5 rounded-[1.25rem] bg-white py-2 pr-2 pl-2.5 shadow-[var(--card-shadow)] dark:border"
    data-testid="chore-bean-card"
    :data-member-id="member.id"
    data-slim="true"
  >
    <BeanieAvatar v-bind="memberAvatarBindings(member)" size="sm" />
    <span class="min-w-0 flex-1">
      <span
        class="font-outfit dark:text-ink text-secondary-500 block truncate text-sm leading-tight font-bold"
        >{{ name }}</span
      >
      <span
        class="dark:text-ink-faint text-secondary-400 block text-xs"
        data-testid="chore-bean-empty"
        >{{ t('choreboard.card.noneYet') }}</span
      >
    </span>
    <button
      v-if="canEdit"
      type="button"
      class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 inline-flex flex-none items-center gap-1 rounded-[0.875rem] bg-[var(--tint-orange-8)] px-3 py-1.5 text-sm font-bold whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
      :aria-label="fillTemplate(t('choreboard.card.addAria'), { name })"
      data-testid="chore-bean-add"
      @click="emit('edit-chores')"
    >
      <span aria-hidden="true">＋</span>
      {{ t('choreboard.addChores') }}
    </button>
  </div>

  <!-- ═══ The card ═══ -->
  <article
    v-else
    ref="card"
    class="dark:bg-surface-raised dark:border-line flex min-w-0 flex-col gap-2 rounded-3xl bg-white p-3 shadow-[var(--card-shadow)] dark:border"
    data-testid="chore-bean-card"
    :data-member-id="member.id"
  >
    <div class="flex items-center gap-2.5">
      <button
        type="button"
        class="group focus-visible:ring-sky-silk-300 flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl text-left focus-visible:ring-2 focus-visible:outline-none"
        :aria-label="fillTemplate(t('choreboard.card.openDay'), { name })"
        data-testid="chore-bean-open"
        @click="emit('open')"
      >
        <BeanieAvatar v-bind="memberAvatarBindings(member)" size="md" />
        <span class="min-w-0 flex-1">
          <span
            class="font-outfit dark:text-ink text-secondary-500 group-hover:text-primary-700 dark:group-hover:text-accent-lift line-clamp-2 text-base leading-tight font-bold break-words"
            >{{ name }}</span
          >
          <span
            class="block truncate text-xs"
            :class="
              total > 0 && day.left === 0
                ? 'text-primary-700 dark:text-accent-lift font-semibold'
                : 'dark:text-ink-faint text-secondary-400'
            "
            :data-testid="total === 0 ? 'chore-bean-empty' : 'chore-bean-left'"
            >{{ subline
            }}<span v-if="total > 0 && day.left === 0" aria-hidden="true"> ⭐</span></span
          >
        </span>
      </button>
      <span
        v-if="total > 0"
        class="font-outfit dark:text-ink text-secondary-500 text-lg font-extrabold whitespace-nowrap"
        data-testid="chore-bean-count"
      >
        {{ fillTemplate(t('choreboard.block.count'), { done, total }) }}
      </span>
      <template v-if="canEdit">
        <!-- Edit Chores: the bean's chore list. -->
        <button
          type="button"
          class="dark:text-ink-soft dark:hover:bg-surface-hover text-secondary-400 hover:text-primary-500 dark:hover:text-accent-lift focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center rounded-xl hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="fillTemplate(t('choreboard.card.editAria'), { name })"
          :title="fillTemplate(t('choreboard.card.editAria'), { name })"
          data-testid="chore-bean-edit"
          @click="emit('edit-chores')"
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
        <button
          type="button"
          class="dark:text-ink-soft dark:hover:bg-surface-hover text-secondary-400 focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center rounded-xl hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="fillTemplate(t('choreboard.card.copyAria'), { name })"
          :title="fillTemplate(t('choreboard.card.copyAria'), { name })"
          data-testid="chore-bean-copy"
          @click="emit('copy')"
        >
          <span aria-hidden="true">📋</span>
        </button>
      </template>
    </div>

    <div v-if="blocks.length" class="flex flex-col gap-1.5">
      <ChoreBlockSummary
        v-for="b in blocks"
        :key="b.block"
        :block="b"
        :starts="starts"
        :bean-name="first"
        :expanded="isOpen(b)"
        @activate="onActivate(b)"
      >
        <div class="flex flex-col gap-1.5" data-testid="chore-block-rows">
          <ChoreRow
            v-for="item in b.chores"
            :key="item.chore.id"
            :chore="item.chore"
            :member-id="member.id"
            :done="item.done"
            compact
            :can-tick="canTick"
            :can-edit="canEdit"
            :pending="isPending(item.chore.id)"
            @toggle="onToggle(b.block, item.chore.id)"
            @edit="emit('edit-chores')"
          />
        </div>
      </ChoreBlockSummary>
    </div>
  </article>
</template>
