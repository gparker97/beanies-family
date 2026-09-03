<script setup lang="ts">
/**
 * One planned meal on the board. Leads with the meal name (prominent), the cook
 * clearly beneath (secondary), a leading recipe-photo thumbnail (emoji fallback),
 * a state dot (orange to-cook / green cooked), and meta glyphs (guests / serve-time)
 * only when present. Non-recipe types render as tinted chips. Clicking
 * opens the editor; draggable on pointer devices (the tap click is the accessible path).
 */
import { computed } from 'vue';
import MealThumb from './MealThumb.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { useMealDrag } from '@/composables/useMealDrag';
import { fillTemplate } from '@/utils/fillTemplate';
import { mealDisplayName } from '@/utils/mealDisplayName';
import { MEAL_TYPE_STYLE, mealTypeEmoji } from '@/constants/mealTypes';
import type { MealPlanEntry, MealSlot } from '@/types/models';

const props = defineProps<{ meal: MealPlanEntry }>();
const emit = defineEmits<{ open: [] }>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();
const { startDrag, endDrag } = useMealDrag();

const SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: '🍳',
  lunch: '🥪',
  dinner: '🍽️',
  snack: '🍎',
};

const recipe = computed(() =>
  props.meal.recipeId ? recipesStore.recipes.find((r) => r.id === props.meal.recipeId) : undefined
);

const isType = computed(() => props.meal.kind !== 'recipe');

const name = computed(() => mealDisplayName(props.meal, recipesStore.recipes, t));

const cook = computed(() =>
  props.meal.cookMemberId
    ? familyStore.members.find((m) => m.id === props.meal.cookMemberId)
    : undefined
);

const guestCount = computed(() => props.meal.guestNames?.length ?? 0);

/**
 * Eat-out, leftovers and skip wear the SAME card chrome as a recipe.
 *
 * They used to be flat tinted chips with no thumbnail, so a row of meals read as two
 * different species of object and the type cards looked unfinished beside a card with a
 * photo. Now every card is a white card with a medallion, and the medallion says which
 * kind it is — the division the calendar already settled on, where the surface says whose
 * and the glyph says what.
 *
 * `skip` keeps a dashed edge and reduced opacity: it is the one kind that means "no meal
 * here", and that should still read as absence at a glance.
 */
const typeTint = computed(() =>
  props.meal.kind === 'recipe' ? '' : MEAL_TYPE_STYLE[props.meal.kind].tint
);
const isSkip = computed(() => props.meal.kind === 'skip');

function onDragStart(e: DragEvent): void {
  startDrag({ source: 'meal', mealId: props.meal.id }, e);
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    draggable="true"
    class="cursor-pointer rounded-[13px] border border-[rgba(44,62,80,0.09)] bg-white p-2 shadow-[var(--card-shadow)] transition-transform duration-150 hover:-translate-y-px hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
    :class="isSkip ? 'border-dashed opacity-70' : ''"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
    @dragstart="onDragStart"
    @dragend="endDrag"
  >
    <div class="flex items-start gap-2">
      <!--
        One medallion on every card, so the grid lines up. A recipe shows its photo (falling
        back to the slot glyph); a type shows its own emoji on a tinted ground — the icon it
        already had in the rail and lost the moment it was dragged onto the board.
      -->
      <MealThumb
        :photo-ids="isType ? undefined : recipe?.photoIds"
        :fallback-emoji="mealTypeEmoji(meal.kind) ?? SLOT_EMOJI[meal.slot]"
        :tint-class="typeTint"
      />
      <div class="min-w-0 flex-1">
        <div
          class="font-outfit text-secondary-500 text-sm leading-tight font-bold break-words dark:text-slate-100"
        >
          {{ name }}
        </div>
        <!-- Nothing to show when there is no cook and no cooked-state dot. -->
        <div v-if="cook || meal.kind === 'recipe'" class="mt-1 flex items-center gap-1.5">
          <!--
            The cook is a FACE, not a face plus their name — the same convention the
            calendar cards use. It showed the initial and the full name side by side, which
            is the one fact twice, on the surface where horizontal space is scarcest.

            `BeanieAvatar` rather than a hand-rolled circle: this was a sixth copy after
            five were collapsed into that component, and the copy had drifted — `charAt(0)`
            initials (which break two-bean collisions and emoji names) and no photo support.
          -->
          <BeanieAvatar
            v-if="cook"
            v-bind="memberAvatarBindings(cook)"
            fallback="initials"
            size="xs"
            class="flex-none ring-2 ring-white dark:ring-slate-800"
          />
          <!--
            No cook, no label. "Anyone" filled a line on the tightest surface in the app to
            say that a field was empty, which the empty space already says — and on most
            meals who cooks is understood without being written down.
          -->
          <span
            v-if="meal.kind === 'recipe'"
            class="ml-auto h-2 w-2 flex-none rounded-full"
            :class="meal.cooked ? 'bg-[#27AE60]' : 'bg-[#F15D22]'"
            :aria-label="meal.cooked ? t('mealPlanner.card.cooked') : t('mealPlanner.card.toCook')"
          />
        </div>
        <div
          v-if="guestCount || meal.serveTime"
          class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[rgba(44,62,80,0.5)] dark:text-slate-400"
        >
          <!--
            No note glyph. It said "there is a note" without saying what, and at the 12px
            floor it costs width a 7rem column does not have — on a card that opens on tap.
          -->
          <span v-if="meal.serveTime" class="font-outfit font-semibold"
            >⏰ {{ meal.serveTime }}</span
          >
          <span v-if="guestCount" class="font-outfit font-semibold">
            👥 {{ fillTemplate(t('mealPlanner.card.guests'), { count: guestCount }) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
