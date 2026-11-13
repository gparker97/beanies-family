<script setup lang="ts">
/**
 * A bean's card on the choreboard home (#146): today's count, the block happening now open and
 * tickable, Anytime beside it, finished blocks folded to an "All Done" strip with their stars,
 * and every other block as a small coloured count. The header opens the bean's day. A bean
 * with no chores at all gets a compact card (and, for a grown-up, a way to add one).
 *
 * A grown-up's header actions: Edit Chores (the bean's day, where every chore has its pencil,
 * and Select can delete several), Copy, and "+" (the Add Chores sheet for this bean only).
 *
 * Reads only the one read model (`BeanChoreDay`); ticks and edits are intents for the page.
 * Dark mode: the card is `surface-raised` with a `line` edge; text is `ink` / `ink-faint`;
 * the progress track is `surface-hover` under the brand gradient.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ChoreBlockSection from '@/components/chores/ChoreBlockSection.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { fillTemplate } from '@/utils/fillTemplate';
import {
  blocksInDisplayOrder,
  choreBlockRank,
  type BeanChoreDay,
  type ChoreDayBlock,
} from '@/utils/chores';
import type { ChoreBlockStarts, FamilyMember } from '@/types/models';

const props = withDefaults(
  defineProps<{
    member: FamilyMember;
    day: BeanChoreDay;
    /** The bean has at least one chore on some day (false draws the compact card). */
    hasAnyChores: boolean;
    starts: ChoreBlockStarts;
    canTick?: boolean;
    canEdit?: boolean;
    isPending?: (choreId: string) => boolean;
  }>(),
  { canTick: true, canEdit: false, isPending: () => false }
);

const emit = defineEmits<{
  toggle: [choreId: string];
  edit: [choreId: string];
  open: [];
  copy: [];
  add: [];
}>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

const total = computed(() => props.day.blocks.reduce((n, b) => n + b.total, 0));
const done = computed(() => total.value - props.day.left);
const pct = computed(() => (total.value ? Math.round((done.value / total.value) * 100) : 0));

/** The bean's blocks with chores, in the one display order (`blocksInDisplayOrder`). */
const withChores = computed(() =>
  blocksInDisplayOrder(props.day.blocks.filter((b) => b.total > 0))
);
/** Shown as sections: the block happening now and Anytime (open, or their done strip). */
const sections = computed(() => withChores.value.filter((b) => choreBlockRank(b) < 2));
/** Every other block: a done strip when finished, otherwise a coloured count. */
const others = computed(() => withChores.value.filter((b) => choreBlockRank(b) >= 2));
const otherDone = computed(() => others.value.filter((b) => b.allDone));
const chips = computed(() => others.value.filter((b) => !b.allDone));

const chipAria = (b: ChoreDayBlock) =>
  fillTemplate(t('choreboard.block.chipAria'), {
    block: t(CHORE_BLOCK_META[b.block].labelKey),
    count: b.total - b.done,
  });

const name = computed(() => props.member.name);
</script>

<template>
  <article
    class="dark:bg-surface-raised dark:border-line flex flex-col gap-2.5 rounded-3xl bg-white p-3 shadow-[var(--card-shadow)] dark:border"
    data-testid="chore-bean-card"
    :data-member-id="member.id"
  >
    <div class="flex items-center gap-2.5">
      <button
        type="button"
        class="focus-visible:ring-sky-silk-300 flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl text-left focus-visible:ring-2 focus-visible:outline-none"
        :aria-label="fillTemplate(t('choreboard.card.openDay'), { name })"
        data-testid="chore-bean-open"
        @click="emit('open')"
      >
        <BeanieAvatar v-bind="memberAvatarBindings(member)" size="md" />
        <span class="min-w-0 flex-1">
          <span
            class="font-outfit dark:text-ink text-secondary-500 block truncate text-base leading-tight font-bold"
            >{{ name }}</span
          >
          <span
            v-if="total > 0"
            class="dark:bg-surface-hover mt-1.5 block h-2 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
            aria-hidden="true"
          >
            <span
              class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r transition-[width] duration-300"
              :style="{ width: `${pct}%` }"
            />
          </span>
          <span
            v-else
            class="dark:text-ink-faint text-secondary-400 mt-0.5 block text-xs"
            data-testid="chore-bean-empty"
            >{{ t(hasAnyChores ? 'choreboard.card.none' : 'choreboard.card.noneYet') }}</span
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
        <!-- Edit Chores: the bean's day, where every chore has its pencil, handle and Select. -->
        <button
          v-if="hasAnyChores"
          type="button"
          class="dark:text-ink-soft dark:hover:bg-surface-hover text-secondary-400 hover:text-primary-500 dark:hover:text-accent-lift focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center rounded-xl hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="fillTemplate(t('choreboard.card.editAria'), { name })"
          :title="fillTemplate(t('choreboard.card.editAria'), { name })"
          data-testid="chore-bean-edit"
          @click="emit('open')"
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
          v-if="hasAnyChores"
          type="button"
          class="dark:text-ink-soft dark:hover:bg-surface-hover text-secondary-400 focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center rounded-xl hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="fillTemplate(t('choreboard.card.copyAria'), { name })"
          :title="fillTemplate(t('choreboard.card.copyAria'), { name })"
          data-testid="chore-bean-copy"
          @click="emit('copy')"
        >
          <span aria-hidden="true">📋</span>
        </button>
        <button
          type="button"
          class="text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-xl font-bold focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="fillTemplate(t('choreboard.card.addAria'), { name })"
          :title="fillTemplate(t('choreboard.card.addAria'), { name })"
          data-testid="chore-bean-add"
          @click="emit('add')"
        >
          <span aria-hidden="true">＋</span>
        </button>
      </template>
    </div>

    <ChoreBlockSection
      v-for="b in sections"
      :key="b.block"
      :block="b"
      :member-id="member.id"
      :bean-name="name"
      variant="card"
      :starts="starts"
      :can-tick="canTick"
      :can-edit="canEdit"
      :is-pending="isPending"
      @toggle="emit('toggle', $event)"
      @edit="emit('edit', $event)"
    />

    <ChoreBlockSection
      v-for="b in otherDone"
      :key="b.block"
      :block="b"
      :member-id="member.id"
      :bean-name="name"
      variant="card"
      :starts="starts"
    />

    <div
      v-if="chips.length"
      class="flex flex-wrap items-center gap-1.5"
      data-testid="chore-bean-chips"
    >
      <span class="dark:text-ink-faint text-secondary-400 text-xs">{{
        t('choreboard.block.more')
      }}</span>
      <span
        v-for="b in chips"
        :key="b.block"
        class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--chore-tint)] px-2.5 py-1 text-xs font-semibold text-[var(--chore-ink)]"
        :class="CHORE_BLOCK_META[b.block].colorClass"
        :aria-label="chipAria(b)"
        data-testid="chore-bean-chip"
        :data-block="b.block"
      >
        <span aria-hidden="true">{{ CHORE_BLOCK_META[b.block].emoji }}</span>
        <span aria-hidden="true">{{ b.total - b.done }}</span>
      </span>
    </div>
  </article>
</template>
