<script setup lang="ts">
/**
 * "not right?" — the free correction, offered from inside the review modal.
 *
 * WHY IT LIVES HERE AND NOT IN THE READING OVERLAY
 * The overlay's resolve beat is ~700ms: far too short to read an answer and decide it is
 * wrong. The review modal is where the user has EVIDENCE — they can see what beanies made of
 * the document — which was the whole argument for the affordance.
 *
 * WHY IT EXPANDS IN PLACE RATHER THAN OPENING A PICKER
 * It used to open a `ChoiceModal` — a modal on top of a modal, for one tap. Expanding in place
 * keeps the whole correction inside the surface the user is already reading, which is the point
 * of putting it here at all: they have just scanned the result and want to say "no, it's a
 * recipe". A second dialog makes them leave the evidence to answer a question about it.
 *
 * It also fixes the tiles. `ChoiceModal` renders `BeanieIcon`, which is a monochrome stroke
 * glyph at 50% opacity — it read as DISABLED. These are the same emoji tiles the sheet offers
 * and the reading overlay resolves, so the vocabulary is identical at all three moments.
 *
 * ⚠️ ADDING A NEW AI KIND: see `src/constants/magicDestinations.ts`. This surface is one of its
 * two renderings and needs no edit — it iterates the module. Do not hand-list kinds here.
 *
 * THE ORDER, and every step of it is load-bearing:
 *   1. `refuseIfBusy` FIRST, before anything opens. `withIngestLock` is taken inside the spine,
 *      after this component has already prompted for consent — so without this the user
 *      answers a prompt and is then refused.
 *   2. The user names the kind. The re-read is targeted BECAUSE they named it; the server
 *      honours the hint only against a spent grant, so there is no way for this to become the
 *      positional "what IS this?" guess the one-surface work exists to remove.
 *   3. A FRESH consent grant. Same document, but a new user action on a different surface, and
 *      `useDocumentConsent`'s header is explicit that one prompt answers for exactly one
 *      document. A grant stashed on the envelope and replayed later is the failure it names.
 *   4. CLOSE THE HOST, then `nextTick`, then ingest. The host IS a review modal and the whole
 *      point of the correction is that it is the wrong one: leaving it mounted stacks two
 *      review modals and routes underneath an open one.
 *
 * WHEN IT RENDERS. `env.correction` must exist at all — without the prepared source there is
 * nothing to re-read, and a `jsonld` / `titleOnly` link never reached the model, so it is
 * correctly absent there. On the MANAGED tier a grant token is required too: the copy promises
 * free, and we do not promise what the server will refuse. BYOK and on-device need no token —
 * their reads cost us nothing, so there is nothing to exempt.
 */
import { computed, nextTick, ref } from 'vue';
import SmoothHeight from '@/components/ui/SmoothHeight.vue';
import { useAiCapability } from '@/composables/useAiCapability';
import { deferConsentForStatement, useDocumentConsent } from '@/composables/useDocumentConsent';
import { useToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { IN_APP_ENV, ingestInAppSource, refuseIfBusy } from '@/composables/useSharedDocumentIngest';
import { MAGIC_DESTINATIONS } from '@/constants/magicDestinations';
import { availableShareKinds } from '@/composables/useMagicReader';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ResultEnvelope, ShareKind } from '@/types/magicPayload';

const props = defineProps<{
  /** The envelope the review modal was handed. Carries the prepared source and the grant. */
  env: ResultEnvelope;
  /** What beanies decided this was — the kind the user is saying is wrong. */
  from: ShareKind;
}>();

const emit = defineEmits<{
  /** The host must unmount itself before the correction starts. See invariant 4 above. */
  (e: 'close'): void;
}>();

const { t } = useTranslation();
const { showToast } = useToast();
const { tier } = useAiCapability();
const { requestConsent } = useDocumentConsent();

const open = ref(false);

/** Free only when the server actually issued a grant. The copy follows the fact, not the hope. */
const isFree = computed(() => props.env.correction?.token != null);

const canCorrect = computed(
  () =>
    props.env.correction != null &&
    (tier.value !== 'managed' || isFree.value) &&
    // Nothing left to offer — with one reader flag off and two kinds, correcting away from
    // `from` may have no destination at all. A banner whose picker is empty is a dead tap.
    options.value.length > 0
);

/**
 * Every kind this member can be routed to (`availableShareKinds`, the one rule shared with the
 * sheet's optional pick) except the one beanies already chose: "correcting" event to event is
 * a no-op the server refuses anyway.
 */
const options = computed(() => availableShareKinds().filter((kind) => kind !== props.from));

const panel = ref<HTMLElement | null>(null);

function openPicker(): void {
  if (refuseIfBusy(IN_APP_ENV)) return;
  open.value = true;
  // ⚠️ Scroll the choices INTO VIEW after expanding.
  //
  // This sits at the foot of a scrolling modal whose save bar is sticky, so expanding at the
  // very bottom opened the tiles UNDERNEATH that bar — the user taps, something clearly
  // happens, and the thing that happened is off-screen. `block: 'nearest'` so a banner already
  // fully visible does not jump.
  void nextTick(() => panel.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

async function pick(to: ShareKind): Promise<void> {
  open.value = false;

  // A bank statement (#107) is read page by page under its OWN consent, which states the read
  // count and the merchant list, so it is deferred to the spine rather than asked twice here.
  const grant = to === 'transactions' ? deferConsentForStatement() : await requestConsent();
  // Declined. The grant is only ever consumed server-side, so it stays spendable and the
  // banner stays offered — a decline costs the family nothing at all.
  if (!grant) return;

  // Titled with the FEATURE, not the affordance: "Tell beanies what it is" reads as an
  // instruction when it arrives as a toast the user has just acted on.
  showToast(
    'info',
    t('ai.capture.title'),
    fillTemplate(t('ai.correct.picked'), { noun: t(`ai.capture.noun.${to}`) })
  );

  emit('close');
  await nextTick();
  void ingestInAppSource({ kind: 'correction', env: props.env, from: props.from, to }, grant);
}
</script>

<template>
  <!-- AT THE BOTTOM of its host, by design: a correction is what someone reaches for AFTER
       scanning the details and finding them wrong, so it sits where their eye ends up rather
       than interrupting the answer on the way in. -->
  <div
    v-if="canCorrect"
    class="dark:bg-surface-overlay mt-5 rounded-[14px] bg-[var(--tint-slate-5)] px-3.5 py-3"
  >
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p class="text-secondary-400 dark:text-ink-soft text-xs">{{ t('ai.correct.prompt') }}</p>
      <button
        type="button"
        class="font-outfit dark:text-accent-lift cursor-pointer text-xs font-semibold text-[#F15D22] underline underline-offset-2"
        :aria-expanded="open"
        @click="openPicker"
      >
        {{ t('ai.correct.action') }}
      </button>
    </div>

    <!-- The expanded choice. `SmoothHeight` animates the disclosure and respects the reduced
         motion preference itself, so there is no second check here. `revision` is what tells it
         a change is deliberate rather than a reflow. -->
    <SmoothHeight :revision="open">
      <div v-if="open" ref="panel" class="pt-3">
        <div class="flex gap-2">
          <button
            v-for="kind in options"
            :key="kind"
            type="button"
            class="dark:bg-surface-raised dark:border-line-strong flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-[14px] border border-[var(--tint-slate-5)] bg-white px-2 py-3 transition-colors hover:border-[#F15D22]/40 hover:bg-[rgba(241,93,34,0.05)] dark:hover:border-orange-500/40 dark:hover:bg-orange-900/15"
            @click="() => void pick(kind)"
          >
            <span aria-hidden="true" class="text-xl leading-none">{{
              MAGIC_DESTINATIONS[kind].emoji
            }}</span>
            <span class="font-outfit dark:text-ink text-xs font-semibold text-[var(--color-text)]">
              {{ t(`ai.capture.dest.${kind}`) }}
            </span>
          </button>
        </div>
        <!-- The free promise lands HERE rather than in the prompt line above: this is the moment
             the user is deciding whether to spend something, and it is the only moment the
             promise is load-bearing. Shown only when the server actually issued a grant. -->
        <p v-if="isFree" class="text-secondary-400 dark:text-ink-faint mt-2 text-xs">
          {{ t('ai.correct.free') }}
        </p>
        <!-- A statement re-read is NOT the free correction: it is read page by page, one bean
             each (#107), so the free promise above must not be read as covering it. -->
        <p
          v-if="options.includes('transactions')"
          class="text-secondary-400 dark:text-ink-faint mt-1 text-xs"
        >
          {{ t('ai.correct.statementNotFree') }}
        </p>
      </div>
    </SmoothHeight>
  </div>
</template>
