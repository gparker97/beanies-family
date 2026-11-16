<script setup lang="ts">
/**
 * Stars and rewards (#148): the ONE shell of the Star Report's "tap a number to see it"
 * summaries (`StarBonusPopover` from a kid's Bonus number, `StarWeekPopover` from a week's bar in
 * Stars by Week). The same convention as a day's summary (`ChoreDayPopover`): `AnchoredSurface`,
 * a bottom sheet over a dim on a phone, a card anchored to what was tapped from 768px; Escape,
 * the dim, an outside click and ✕ close it; focus starts on ✕ and returns to what was tapped.
 *
 * It draws the head (the kid's avatar, a title, the week) and the ✕; the body is the default
 * slot and the foot line is `foot`. `testid` names the card (`<testid>`), its dim
 * (`<testid>-dim`) and ✕ (`<testid>-close`). Presentational: it knows nothing of the store.
 *
 * Dark mode: the shared `CHORE_POPOVER_*` look (`surface-overlay`, `line-strong` edge); text
 * `secondary-*` / `ink*`; ✕ `secondary-400` / `ink-faint`, Heritage Orange / `accent-lift` on
 * hover over `--tint-slate-5` / `surface-hover`; the foot's rule `--color-border` / `line`.
 */
import AnchoredSurface from '@/components/ui/AnchoredSurface.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { CHORE_POPOVER_CARD, CHORE_POPOVER_SHEET } from '@/constants/tileStyles';
import type { FamilyMember } from '@/types/models';

defineProps<{
  open: boolean;
  member: FamilyMember | null;
  title: string;
  subtitle: string;
  /** What was tapped: the wide card hangs from it, and focus returns to it on close. */
  anchor: HTMLElement | null;
  testid: string;
  /** The foot line (read only, or how to remove). */
  foot: string;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();
</script>

<template>
  <AnchoredSurface
    :open="open && !!member"
    :anchor="anchor"
    :label="title"
    surface="chore-stars"
    :inside-el="anchor"
    align="end"
    :width-estimate="320"
    :height-estimate="320"
    :initial-focus="`[data-testid='${testid}-close']`"
    :card-testid="testid"
    :dim-testid="`${testid}-dim`"
    :sheet-class="CHORE_POPOVER_SHEET"
    :card-class="CHORE_POPOVER_CARD"
    :data-member-id="member?.id"
    @close="emit('close')"
  >
    <template #default="{ isSheet }">
      <div v-if="member" class="p-3.5 text-left" :class="isSheet ? 'pt-2' : ''">
        <div class="flex items-center gap-2.5">
          <BeanieAvatar v-bind="memberAvatarBindings(member)" size="sm" />
          <div class="min-w-0 flex-1">
            <p
              class="font-outfit dark:text-ink text-secondary-500 truncate text-base leading-tight font-bold"
            >
              {{ title }}
            </p>
            <p class="dark:text-ink-soft text-secondary-500 text-sm">{{ subtitle }}</p>
          </div>
          <button
            type="button"
            class="dark:text-ink-faint dark:hover:bg-surface-hover text-secondary-400 hover:text-primary-500 dark:hover:text-accent-lift focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center rounded-xl hover:bg-[var(--tint-slate-5)] focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="t('action.close')"
            :data-testid="`${testid}-close`"
            @click="emit('close')"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <slot />

        <p
          class="dark:border-line dark:text-ink-faint text-secondary-400 mt-3 border-t border-[var(--color-border)] pt-2.5 text-xs"
          :data-testid="`${testid}-foot`"
        >
          {{ foot }}
        </p>
      </div>
    </template>
  </AnchoredSurface>
</template>
