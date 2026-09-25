<script setup lang="ts">
/**
 * What a family sees while beanies reads something, and the moment it works out what it is.
 *
 * ONE mount, in `App.vue`. It used to be four — the planner, travel and the cookbook each had
 * their own — which is why "the reader looks identical whichever door the document came
 * through" had to be maintained by hand across four call sites. Now every door feeds the same
 * ingest, so the overlay reads the ingest's own state directly rather than taking `:open`.
 *
 * THE RESOLVE. The three destination tiles are the same three the sheet shows at rest, and
 * carrying them across that transition is the whole idea: the sheet says what beanies CAN
 * make, and this says what it DID. Two fade, one lifts into the brand gradient with a single
 * sheen pass. The beat that makes it visible is held in the spine (`RESOLVE_HOLD_MS`), not
 * here — without it the routing and the state reset happen in the same tick and nobody ever
 * sees it.
 *
 * THE WAIT ITSELF. "Counting magic beans…" is the one place the app says "magic beans" instead of
 * the house "counting beans…" loader, and it is a deliberate, single exception: this is the only
 * surface where the wait IS the feature. The light travels through the letterforms and four small
 * sparkles drift behind the card. Everything here is restrained on purpose — the card already
 * carries a spinner and three ticking tiles, and the resolve has to stay the loudest moment in
 * the sequence.
 *
 * `RecipeFormModal` keeps its own in-form overlay and is deliberately NOT served by this one:
 * its feedback is scoped to the fields that are about to be overwritten, and a full-screen
 * overlay would hide the very thing it is about. That is why the spine's state carries
 * `presentation` — the global overlay simply does not open for a door that claims its payload.
 */
import { magicIngestState } from '@/composables/useSharedDocumentIngest';
import { isReadingSharedDocument } from '@/composables/useSharedDocumentIngest';
import { useTranslation } from '@/composables/useTranslation';
import { MAGIC_DESTINATIONS, MAGIC_DESTINATION_KINDS } from '@/constants/magicDestinations';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';

const { t } = useTranslation();

/** The kind the model settled on, or null while it is still reading. */
const resolvedKind = () =>
  magicIngestState.value.phase === 'resolved' ? magicIngestState.value.kind : null;

/**
 * The tile that is LIT: the resolved kind, or — while still reading — the kind the person
 * picked in the sheet (#108). A hinted read starts with its tile already lifted and resolves in
 * place, so the pick reads as the answer here too; if the model overrules it the lift moves to
 * the kind it chose, which is the honest picture. The spinner and the exit fade key on
 * `resolvedKind()` alone, so the wait still reads as a wait.
 */
const litKind = () => {
  const state = magicIngestState.value;
  if (state.phase === 'resolved') return state.kind;
  return state.phase === 'reading' ? (state.hint ?? null) : null;
};
</script>

<template>
  <div
    v-if="isReadingSharedDocument"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm"
  >
    <!-- `relative` so the sparkles measure against the CARD rather than the viewport: scattered
         across a full-screen backdrop they would read as page decoration instead of something
         happening to this one thing. -->
    <div class="relative">
      <!-- Drawn, not the ✨ emoji: an emoji is a different picture on every platform and cannot
           take Heritage Orange. Behind the card — no z-index needed, they precede it in source
           order and the card paints its own background — and `pointer-events-none` so they can
           never eat a tap meant for something underneath.

           ⚠️ The offsets are what make them SPARKS AROUND THE CARD rather than specks on its
           edge, and the first pass got that wrong: four at 10-14px hugging the corners were
           invisible on the blurred scrim. Keep them outside the card and keep the sizes here in
           step with the glow in `.magic-sparkle`. Staggered delays, never a shared one. -->
      <span
        aria-hidden="true"
        class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -top-7 -left-8 h-5 w-5"
      />
      <span
        aria-hidden="true"
        class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -top-9 right-10 h-3.5 w-3.5"
        style="animation-delay: 0.5s"
      />
      <span
        aria-hidden="true"
        class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -top-4 -right-9 h-6 w-6"
        style="animation-delay: 1.05s"
      />
      <span
        aria-hidden="true"
        class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -bottom-8 -left-6 h-4 w-4"
        style="animation-delay: 1.6s"
      />
      <span
        aria-hidden="true"
        class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -right-7 -bottom-9 h-5 w-5"
        style="animation-delay: 2.15s"
      />
      <span
        aria-hidden="true"
        class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -bottom-6 left-1/3 h-3.5 w-3.5"
        style="animation-delay: 2.7s"
      />

      <div
        class="dark:bg-surface-raised relative flex flex-col items-center gap-4 rounded-3xl bg-white px-8 py-6 shadow-[var(--soft-shadow)]"
      >
        <BeanieSpinner v-if="!resolvedKind()" size="lg" :halo="true" />

        <!-- The same tiles the sheet shows, now answering rather than offering. Faint while
           reading; on resolve the others fall back and one lifts. A read the person pre-labelled
           starts with that tile lit and nothing ticking (`litKind`). Visually unlabelled by
           design — the strings are their accessible names. -->
        <ul class="flex list-none gap-2.5 p-0">
          <!-- `magic-tick` on the LI, not the tile: its stagger is `:nth-child`, so it has to sit
             on the element that is actually the nth child of this list. -->
          <li
            v-for="kind in MAGIC_DESTINATION_KINDS"
            :key="kind"
            :class="litKind() ? '' : 'magic-tick'"
          >
            <div
              class="flex h-16 w-16 flex-col items-center justify-center rounded-[14px] transition-all duration-300"
              :class="
                litKind() === kind
                  ? 'from-primary-500 to-terracotta-400 magic-shimmer magic-shimmer-once scale-110 bg-gradient-to-br shadow-[0_12px_26px_-10px_rgba(241,93,34,0.65)]'
                  : // ⚠️ Opacity ONLY on the two tiles that are on their way out. The CIG forbids an
                    // opacity modifier on text a person reads, and the RESTING state is read —
                    // these labels are the tiles' accessible names. So at rest the faintness
                    // comes from the tint background and a fainter ink, not from compositing the
                    // label down; the 30% is a 300ms exit on something already answered.
                    resolvedKind()
                    ? 'dark:bg-surface-overlay bg-[var(--tint-slate-5)] opacity-30'
                    : 'dark:bg-surface-overlay bg-[var(--tint-slate-5)]'
              "
            >
              <span aria-hidden="true" class="relative z-[1] text-xl leading-none">{{
                MAGIC_DESTINATIONS[kind].emoji
              }}</span>
              <span
                class="font-outfit relative z-[1] mt-1 block text-xs font-semibold"
                :class="
                  litKind() === kind ? 'text-white' : 'text-secondary-400 dark:text-ink-faint'
                "
              >
                {{ t(`ai.capture.dest.${kind}`) }}
              </span>
            </div>
          </li>
        </ul>

        <!-- No text colour utility here on purpose: `.magic-text-shimmer` owns the colour in both
             themes, because the gradient and the fallback have to agree. -->
        <p class="font-outfit magic-text-shimmer text-sm font-semibold">
          {{ t('ai.processing') }}
        </p>
      </div>
    </div>
  </div>
</template>
