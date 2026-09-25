<script setup lang="ts">
/**
 * The one magic-beans surface (#84) — direction B of
 * `docs/mockups/magic-beans-one-button-2026-09-03.html`, with the optional pick of #108
 * (direction C of `docs/mockups/magic-beans-category-chips-2026-09-25.html`).
 *
 * DESIGN NOTE — why there is no MANDATORY type chooser, and why there is an optional one.
 *
 * The three chips #84 replaced (📸 invite / ✈️ travel booking / 🍳 recipe) asked the user
 * "what IS this?" before beanies had looked at it, as a question that had to be answered. That
 * is the AI's job, and picking wrong did not produce a helpful error, it produced a bad
 * extraction: a filled-in form of the wrong shape that the user has to notice. The share path
 * never asked it, which is why the same school PDF landed correctly from Gmail and wrongly
 * from inside beanies.
 *
 * So this asks "where is it?" instead, which is a question the user always knows the answer
 * to. The paste field is the hero because it is the case with no other home — a photo already
 * has a camera button, but a class-group message has nothing. Camera and file sit underneath,
 * one tap away and visually quieter.
 *
 * THE TILES ARE AN OFFER, NOT A QUESTION (#108). The person handing something over always
 * knows what it is, so the capability tiles at the foot are tappable: "tell us what this is"
 * lets them help beanies out in advance, for this one capture. Nothing selected is the default
 * and stays the common case — Save never waits on a pick, and the tiles never ask. A pick is
 * emitted as `hint` and is authoritative for that read (the orchestrator sends it down the same
 * channel a "not right?" correction uses). A door on a page opens the sheet with that page's
 * tile already picked (`initialHint`: greg's call, 2026-09-25, reversing the 2026-09-14 plan's
 * "nothing about WHERE the sheet was opened is ever sent"); it is shown lit, so the person sees
 * it and can clear it, and the ingest logs it apart from a pick the person made.
 *
 * The sheet is a VIEW. It draws the `kinds` it is given — the door filters them by permission
 * and flag through `availableShareKinds` — and knows nothing about readers itself.
 *
 * This used to sit beside `RecipeLinkModal`, which asked the same question in a link-only way:
 * it validated a URL, disabled save until it routed, and showed a three-way hint. That modal is
 * gone. Every door now opens THIS sheet, which accepts anything non-empty and validates
 * nothing, because deciding what the content is IS the feature — a link-only second door was
 * the last place that still asked the user to have the right KIND of thing in hand.
 *
 * ⚠️ Every action closes this sheet BEFORE starting the ingest, and that must not be relaxed.
 * Two of the three original reasons still hold: `useFullscreenOverlay` holds a body-scroll
 * lock, and `openQuickAdd()` refuses outright while any overlay is open, which would leave the
 * FAB dead until a reload.
 *
 * The third — a z-index collision with `AiProcessingOverlay` at `z-[60]` — went away when this
 * moved to `layer="top"` (`z-[250]`). That move is SAFE BECAUSE of this ordering, not a
 * replacement for it: do not reason backwards from the z-index.
 *
 * WHY `layer="top"`. Since the doors were unified this sheet opens from inside other modals —
 * the activity modal's quick-start tile, the recipe form's source strip. At `layer="overlay"`
 * its backdrop sits at `z-[55]`, UNDER a host modal's own `z-[60]` panel, leaving that host
 * bright and clickable behind it. Fixing it here rather than per-door is what stops every
 * future door having to make a stacking decision it can get wrong.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import AiSourceButtons from '@/components/ai/AiSourceButtons.vue';
import { useTranslation } from '@/composables/useTranslation';
import { MAGIC_DESTINATIONS } from '@/constants/magicDestinations';
import { routeUrl } from '@/utils/recipeSourceUrl';
import type { ShareKind } from '@/types/magicPayload';

const props = defineProps<{
  open: boolean;
  /** The tiles to draw, in order, already filtered to what this member can be routed to. */
  kinds: ShareKind[];
  /** A kind picked for the person when the sheet opens (#107, the Budget page's import tile). */
  initialHint?: ShareKind;
}>();
/**
 * Every capture intent carries the optional pick as `hint` — `undefined` is "no pick", and
 * `null` never crosses this boundary, so no caller converts between the two.
 */
const emit = defineEmits<{
  close: [];
  /** Pasted text or a pasted link — the orchestrator decides which. */
  submit: [text: string, hint?: ShareKind];
  camera: [hint?: ShareKind];
  file: [hint?: ShareKind];
}>();

const { t } = useTranslation();

const text = ref('');

/** The one tile the person tapped, if any. Local, view-side name; it travels as `hint`. */
const pickedKind = ref<ShareKind | undefined>();

function togglePick(kind: ShareKind): void {
  pickedKind.value = pickedKind.value === kind ? undefined : kind;
}

/**
 * What actually travels as `hint`: the pick, only while its tile is still offered. Derived
 * rather than watched, so a `kinds` that shrinks while the sheet is open (every emit site
 * reads this one value) can never buy a read the reader gate would refuse.
 */
const hint = computed(() =>
  pickedKind.value && props.kinds.includes(pickedKind.value) ? pickedKind.value : undefined
);

/**
 * Columns, from the count: three across is the row the sheet has always drawn, so up to three
 * kinds stay on one row at EVERY width (fractions, not a minimum track — a `minmax(5.5rem)`
 * grid wrapped the third tile to a half-width orphan at 320px and under Large reading mode).
 * Four kinds sit two by two; more re-flow in rows of three.
 */
const cols = computed(() => {
  const n = props.kinds.length;
  if (n <= 3) return Math.max(n, 1);
  return n === 4 ? 2 : 3;
});

/**
 * The selected look is the same light recipe `ChipButton` ships (Heritage Orange text, border
 * and `--tint-orange-8`), so the app has one "selected" vocabulary. On dark the tile sits on
 * `surface-overlay`, so its selected background is the next surface step and the accent takes
 * its `-lift` partner — never a darker orange, per the CIG.
 */
const TILE_AT_REST =
  'dark:bg-surface-overlay dark:hover:bg-surface-hover border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)]';
const TILE_SELECTED =
  'border-primary-500 dark:border-accent-lift dark:bg-surface-hover bg-[var(--tint-orange-8)]';

/**
 * A single pasted token that looks like a link but will not route.
 *
 * Only for the single-token case: a link inside a sentence is handled by the spine's
 * link-vs-text triage, and flagging it here would second-guess that. This is purely an
 * explanation — `handleSave` still accepts anything non-empty.
 */
const showBadLinkHint = computed(() => {
  const value = text.value.trim();
  if (!value || /\s/.test(value)) return false;
  if (!/^[a-z]+:\/\//i.test(value) && !value.includes('.')) return false;
  return routeUrl(value).kind === 'invalid';
});
const fieldWrap = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    text.value = '';
    // A pick is for ONE capture. Remembering it across opens is explicitly out of scope (#108);
    // a door that opens pre-picked (#107) seeds it fresh on every open instead.
    pickedKind.value = props.initialHint;
    // Focused on open — the whole point of this layout is that you can paste immediately.
    // Guarded because BaseTextarea may not have mounted on the first tick.
    await nextTick();
    fieldWrap.value?.querySelector('textarea')?.focus();
  }
);

function handleSave(): void {
  const value = text.value.trim();
  // Empty is the ONLY thing refused here. Length bands, link-vs-text and the budget all live
  // in the orchestrator's `sourceFromText`, shared with the share path — a second opinion
  // about what text is acceptable is exactly the divergence #84 exists to remove.
  if (!value) return;
  emit('submit', value, hint.value);
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    layer="top"
    :open="open"
    :title="t('ai.capture.title')"
    custom-header
    size="default"
    :save-disabled="!text.trim()"
    :save-label="t('ai.capture.action')"
    @close="emit('close')"
    @save="handleSave"
  >
    <!-- THE HEADER ITSELF, not a block under it: the feature's name and its tagline in one
         tinted gradient, occupying the whole header area with no rule beneath. That is what the
         approved mockup draws, and it is what makes magic beans read as a feature rather than
         another form.

         ⚠️ Deliberately DIFFERENT from every other drawer, which puts only a title there. Two
         earlier attempts were both worse: the band in the BODY under a standard header did not
         match the mockup, and removing the title to fix that left an EMPTY bar above the rule.

         This is also what the sheen travels across, and deliberately not the textarea: a
         shimmer over an input is the skeleton-loader idiom, so it reads as loading or disabled
         and it fights the caret. `--magic-sheen-color` is set by `.magic-tagline-band` because
         the shared sheen is white, which is invisible on a light tint. -->
    <template #custom-header>
      <div class="magic-shimmer magic-shimmer-slow magic-tagline-band px-6 py-4">
        <p
          class="font-outfit dark:text-ink relative z-[1] m-0 flex items-center gap-2 text-lg leading-tight font-bold text-[var(--color-text)]"
        >
          <span aria-hidden="true">✨</span>{{ t('ai.capture.title') }}
        </p>
        <p
          class="text-primary-500 dark:text-accent-lift relative z-[1] mt-0.5 mb-0 font-[Caveat,Outfit,cursive] text-base leading-snug font-bold"
        >
          {{ t('ai.capture.tagline') }}
        </p>
      </div>
    </template>

    <FormFieldGroup :label="t('ai.capture.label')">
      <div ref="fieldWrap">
        <!-- A TEXTAREA, not an input: a pasted class-group message is several lines, and a
             single-line field that scrolls sideways makes it impossible to check what you
             pasted. Keyboard avoidance is inherited from BaseSidePanel's full-height
             scrolling column — no visualViewport code belongs here. -->
        <BaseTextarea v-model="text" :rows="4" :placeholder="t('ai.capture.placeholder')" />
      </div>
      <!-- Non-blocking. The sheet refuses ONLY emptiness — deciding what the content is IS the
           feature — so a link that will not route is explained, never disallowed. -->
      <p
        v-if="showBadLinkHint"
        class="font-outfit text-primary-500 dark:text-accent-lift mt-1.5 text-xs"
      >
        {{ t('ai.capture.badLinkHint') }}
      </p>
    </FormFieldGroup>

    <AiSourceButtons @camera="emit('camera', hint)" @file="emit('file', hint)" />

    <!-- What beanies can make, offered as an OPTIONAL pick (#108). The tiles say what the answer
         could be; tapping one says what it IS, for this capture only. Nothing selected is the
         default and looks like it: quiet slate tiles, no empty slot, no placeholder.

         The column count comes from how many kinds there are (`cols`), never from a minimum
         track width, so three tiles share one row at every width and Large reading mode simply
         scales them; more kinds re-flow in rows of three. The labels are the tiles' ACCESSIBLE
         names as well as their visible ones.

         At rest here; they tick and resolve in AiProcessingOverlay, which is where the reading
         actually happens (this sheet closes before the ingest starts). Carrying the same tiles
         across that transition is what makes the resolve read as an answer — and a picked tile
         arrives there already lit. -->
    <div class="mt-6">
      <div class="mb-2 flex items-baseline justify-between gap-2">
        <p class="font-outfit dark:text-ink m-0 text-sm font-semibold text-[var(--color-text)]">
          {{ t('ai.capture.pick.title') }}
        </p>
        <span class="text-secondary-400 dark:text-ink-faint text-xs">
          {{ t('ai.capture.pick.optional') }}
        </span>
      </div>
      <div
        role="group"
        :aria-label="t('ai.capture.pick.title')"
        class="grid grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-2"
        :style="{ '--cols': cols }"
      >
        <button
          v-for="kind in kinds"
          :key="kind"
          type="button"
          :aria-pressed="pickedKind === kind"
          class="dark:focus-visible:ring-offset-surface-raised cursor-pointer rounded-[14px] border-2 px-1 pt-2.5 pb-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:ring-offset-2 motion-reduce:transition-none"
          :class="pickedKind === kind ? TILE_SELECTED : TILE_AT_REST"
          @click="togglePick(kind)"
        >
          <span aria-hidden="true" class="block text-xl leading-none">{{
            MAGIC_DESTINATIONS[kind].emoji
          }}</span>
          <span
            class="font-outfit mt-1.5 block text-xs font-semibold"
            :class="
              pickedKind === kind
                ? 'text-primary-500 dark:text-accent-lift'
                : 'text-secondary-400 dark:text-ink-faint'
            "
          >
            {{ t(`ai.capture.dest.${kind}`) }}
          </span>
        </button>
      </div>
      <!-- Two interpolations, never a concatenation: each string is its own translation unit. -->
      <p
        class="font-outfit mt-2 mb-0 text-xs font-semibold"
        :class="
          hint ? 'text-primary-500 dark:text-accent-lift' : 'text-secondary-400 dark:text-ink-faint'
        "
      >
        <template v-if="hint">
          {{ t(`ai.capture.pick.as.${hint}`) }} {{ t('ai.capture.pick.undo') }}
        </template>
        <template v-else>{{ t('ai.capture.pick.idle') }}</template>
      </p>
    </div>
  </BeanieFormModal>
</template>
