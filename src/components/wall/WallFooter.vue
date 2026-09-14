<script setup lang="ts">
/**
 * The foot: who you are looking at, and whose wall this is.
 *
 * MULTI-SELECT. Tapping beans adds them to the focus; tapping a focused bean drops it, and
 * "everyone" clears. Every wall view has always taken `string[] | null`, so this footer was the
 * only thing making the filter single.
 *
 * ⚠️ It WAS single-select on purpose, and the reason deserves answering rather than deleting:
 * on an unattended shared screen a half-filtered state nobody noticed is a way to miss a
 * pickup. Three things address it, and they are why multi-select is safe here now:
 *   · every focused bean is a LIT chip — the state is always legible from across the room,
 *     which is not true of a checkbox set behind a menu;
 *   · dropping the last one falls back to everyone, so there is no "matches nobody" state;
 *   · waking the wall from its night screen clears the filter — though night mode is only ever
 *     entered BY HAND from the lock menu or the face button, so this helps a wall someone put to
 *     bed and does nothing for one simply left running. Stated honestly because the first draft
 *     of this comment claimed a nightly reset that does not exist.
 *
 * Deliberately NOT wired to `memberFilterStore`: that filter is the account holder's,
 * persisted and shared with the planner, and a child poking the wall must not silently
 * re-filter a parent's phone. That reasoning is untouched by going multi-select.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

/** `focused` is EMPTY for everyone — never a list that matches nobody. */
const props = defineProps<{ focused: readonly string[] }>();
const emit = defineEmits<{
  /** Toggle one bean in or out of the focus. The page owns the semantics. */
  select: [string];
  /** Back to everyone. */
  clear: [];
}>();

const isEveryone = computed(() => props.focused.length === 0);
const isFocused = (id: string) => props.focused.includes(id);

const { t } = useTranslation();
const familyStore = useFamilyStore();
const members = computed(() => familyStore.sortedHumans);

const { memberAvatarBindings } = useMemberAvatarBindings();
</script>

<template>
  <!-- ⚠️ `overflow-x-auto`, and deliberately NOT `flex-wrap`.
       A clipped chip can be a LIT one, and every focused bean being visible is the one
       mitigation this control relies on — `.wall-root` is `overflow-hidden`, the wall's floor is
       600px, and "everyone" plus five avatar chips plus the brand lockup does not fit in the
       ~544px left after the padding.
       Wrapping was tried and is worse: a second chip row adds ~46px to a `shrink-0` footer
       inside a `100dvh` column, taken out of `<main>` — but every layout decision on this page
       measures `window.innerHeight`, which does not move, so the band and the time grid keep
       being sized for height that is no longer there. Scrolling costs nothing vertically and
       reaches every chip. -->
  <div class="flex shrink-0 items-center gap-2 overflow-x-auto px-7 pt-3 pb-4">
    <button
      type="button"
      class="font-outfit wall-chip-person rounded-full px-3.5 py-1.5 font-semibold shadow-[var(--card-shadow)]"
      :class="
        isEveryone
          ? 'bg-secondary-500 text-white'
          : 'text-secondary-500 dark:bg-surface-raised dark:text-ink bg-white'
      "
      :aria-pressed="isEveryone"
      @click="emit('clear')"
    >
      {{ t('wall.filter.everyone') }}
    </button>
    <button
      v-for="member in members"
      :key="member.id"
      type="button"
      class="font-outfit wall-chip-person flex items-center gap-2 rounded-full py-1 pr-3.5 pl-1 font-semibold shadow-[var(--card-shadow)]"
      :class="
        isFocused(member.id)
          ? 'bg-secondary-500 text-white'
          : 'text-secondary-500 dark:bg-surface-raised dark:text-ink bg-white'
      "
      :aria-pressed="isFocused(member.id)"
      @click="emit('select', member.id)"
    >
      <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="sm" />
      {{ member.name }}
    </button>

    <span class="font-outfit wall-brand ml-auto font-bold opacity-70">
      <span class="text-[var(--muted-text,#4d5d6c)]">beanies</span
      ><span class="text-[var(--heritage-orange)]">.family</span>
    </span>
  </div>
</template>
