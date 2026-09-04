<script setup lang="ts">
/**
 * Nook "Today's meals" card — mirrors the other nook section cards. Shows today's
 * planned meals (slot · name · cook) and emits `open-meal` so the FamilyNookPage's
 * single MealEditModal handles the edit (one editor host).
 */
import { computed } from 'vue';
import NookSectionCard from './NookSectionCard.vue';
import MealThumb from '@/components/mealplan/MealThumb.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { MEAL_TYPE_STYLE, mealTypeEmoji } from '@/constants/mealTypes';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { SLOT_EMOJI, SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import { useTranslation } from '@/composables/useTranslation';
import { mealDisplayName } from '@/utils/mealDisplayName';
import type { MealPlanEntry } from '@/types/models';

const emit = defineEmits<{ openMeal: [meal: MealPlanEntry] }>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();
const mealPlanStore = useMealPlanStore();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();

const meals = computed(() => mealPlanStore.todaysMeals);

function recipeFor(m: MealPlanEntry) {
  return m.recipeId ? recipesStore.recipes.find((r) => r.id === m.recipeId) : undefined;
}
function nameFor(m: MealPlanEntry): string {
  return mealDisplayName(m, recipesStore.recipes, t);
}
function cookFor(m: MealPlanEntry) {
  return m.cookMemberId ? familyStore.members.find((x) => x.id === m.cookMemberId) : undefined;
}
</script>

<template>
  <NookSectionCard :title="`🍲 ${t('mealPlanner.nook.title')}`">
    <p
      v-if="!meals.length"
      class="font-inter dark:text-ink-soft py-2 text-sm text-[rgba(44,62,80,0.5)]"
    >
      {{ t('mealPlanner.nook.empty') }}
    </p>
    <ul v-else class="divide-y divide-[rgba(44,62,80,0.06)]">
      <li v-for="m in meals" :key="m.id">
        <button
          type="button"
          class="flex w-full items-center gap-2.5 py-2 text-left"
          @click="emit('openMeal', m)"
        >
          <span
            class="font-outfit dark:text-ink-faint w-14 flex-none text-xs font-semibold tracking-[0.05em] text-[rgba(44,62,80,0.45)] uppercase"
          >
            {{ t(SLOT_LABEL_KEYS[m.slot]) }}
          </span>
          <!--
            A medallion on EVERY meal, as on the board. It was `v-if="kind === 'recipe'"`,
            so eat-out, leftovers and skip had no icon here at all and the rows did not line
            up — the same gap the board's type cards had before `MEAL_TYPE_STYLE` existed.
          -->
          <MealThumb
            :photo-ids="m.kind === 'recipe' ? recipeFor(m)?.photoIds : undefined"
            :fallback-emoji="mealTypeEmoji(m.kind) ?? SLOT_EMOJI[m.slot]"
            :tint-class="m.kind === 'recipe' ? '' : MEAL_TYPE_STYLE[m.kind].tint"
            :size-rem="1.6"
          />
          <span
            class="font-outfit text-secondary-500 dark:text-ink min-w-0 flex-1 truncate text-sm font-semibold"
          >
            {{ nameFor(m) }}
          </span>
          <!--
            `BeanieAvatar`, not a seventh hand-rolled circle. This one had drifted the same
            three ways the board card had: `name[0]` initials (which break a two-bean
            collision and any emoji name), a raw `color` so a member with none set rendered
            white-on-transparent, and no photo support.
          -->
          <BeanieAvatar
            v-if="cookFor(m)"
            v-bind="memberAvatarBindings(cookFor(m)!)"
            fallback="initials"
            size="xs"
            class="flex-none"
          />
        </button>
      </li>
    </ul>
  </NookSectionCard>
</template>
