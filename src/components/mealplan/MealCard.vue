<script setup lang="ts">
/**
 * One planned meal on the board. Leads with the meal name (prominent), the cook
 * clearly beneath (secondary), a leading recipe-photo thumbnail (emoji fallback),
 * a green tick on the medallion once it has been cooked, and meta glyphs (guests /
 * serve-time) only when present. Non-recipe types render as tinted chips. Clicking
 * opens the editor; draggable on pointer devices (the tap click is the accessible path).
 */
import { computed } from 'vue';
import MealThumb from './MealThumb.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { SLOT_EMOJI } from '@/constants/mealSlots';
import { useTranslation } from '@/composables/useTranslation';
import { useMealDrag } from '@/composables/useMealDrag';
import { fillTemplate } from '@/utils/fillTemplate';
import { mealDisplayName } from '@/utils/mealDisplayName';
import { MEAL_TYPE_STYLE, mealTypeEmoji } from '@/constants/mealTypes';
import type { MealPlanEntry } from '@/types/models';

const props = defineProps<{ meal: MealPlanEntry }>();
const emit = defineEmits<{ open: [] }>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();
const { startDrag, endDrag } = useMealDrag();

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
/**
 * Guarded, like `mealTypeEmoji` beside it.
 *
 * This replaced a `switch` whose `default:` absorbed any unrecognised kind. Nothing
 * validates `kind` on the read path (the projection is a raw cast and the repository a
 * passthrough), and cross-version CRDT merge is a supported scenario — so a sixth
 * `MealKind` shipped while an older client is still in the family would throw inside a
 * computed, and Vue's handler would swap the card for a comment node and page
 * #beanies-errors on every render.
 */
const typeTint = computed(() =>
  props.meal.kind === 'recipe'
    ? ''
    : (MEAL_TYPE_STYLE[props.meal.kind]?.tint ?? MEAL_TYPE_STYLE.other.tint)
);
const isSkip = computed(() => props.meal.kind === 'skip');
/** Only a recipe can be cooked; a type card has nothing to cook. */
const isCooked = computed(() => props.meal.kind === 'recipe' && props.meal.cooked === true);

function onDragStart(e: DragEvent): void {
  startDrag({ source: 'meal', mealId: props.meal.id }, e);
}
</script>

<template>
  <!--
    SKIP KEEPS TRANSPARENT CHROME. Unifying the type cards gave every kind the white card,
    shadow and 0.09 border, and skip added only `border-dashed` on top — which halved the
    dash to ~6% alpha and gave "nothing planned" a fill and a drop shadow. It is the one
    kind that means absence, so it has no fill, no shadow, and a dash strong enough to read.
  -->
  <div
    role="button"
    tabindex="0"
    draggable="true"
    class="cursor-pointer rounded-[13px] border p-2 transition-transform duration-150 hover:-translate-y-px"
    :class="
      isSkip
        ? 'dark:border-line-strong border-dashed border-[rgba(44,62,80,0.28)] opacity-70'
        : 'dark:bg-surface-raised border-[rgba(44,62,80,0.09)] bg-white shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)]'
    "
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
      <span class="relative flex-none">
        <MealThumb
          :photo-ids="isType ? undefined : recipe?.photoIds"
          :fallback-emoji="mealTypeEmoji(meal.kind) ?? SLOT_EMOJI[meal.slot]"
          :tint-class="typeTint"
        />
        <!--
          COOKED is marked; not-cooked is not.
          There used to be a dot on every recipe card — orange for to-cook, green for done —
          which spent a slot in the tightest row in the app to report the ordinary state.
          Not-yet-cooked is what almost every meal is almost all of the time, and a planner
          full of orange dots says nothing. Only the exception earns a mark, and it rides on
          the medallion so it costs no width at all.
        -->
        <span
          v-if="isCooked"
          class="dark:ring-surface-raised absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full bg-[#27AE60] text-white ring-2 ring-white"
          :aria-label="t('mealPlanner.card.cooked')"
          role="img"
        >
          <!-- SVG, not a "✓" glyph: a tick sized to fit a 16px badge would have to be set
               below the 12px type floor, and this is an icon rather than text. -->
          <svg
            class="h-2.5 w-2.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
      </span>
      <div class="min-w-0 flex-1">
        <div
          class="font-outfit text-secondary-500 dark:text-ink text-sm leading-tight font-bold break-words"
        >
          {{ name }}
        </div>
        <!--
          Right-anchored, like every face in the calendar — it sat left, so on mobile the
          chip landed mid-card or hard left depending on what else was in the row and never
          lined up down a column.
        -->
        <div v-if="cook" class="mt-1 flex items-center justify-end gap-1.5">
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
            class="dark:ring-surface-raised flex-none ring-2 ring-white"
          />
          <!--
            No cook, no label. "Anyone" filled a line on the tightest surface in the app to
            say that a field was empty, which the empty space already says — and on most
            meals who cooks is understood without being written down.
          -->
        </div>
        <div
          v-if="guestCount || meal.serveTime"
          class="dark:text-ink-soft mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[rgba(44,62,80,0.5)]"
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
