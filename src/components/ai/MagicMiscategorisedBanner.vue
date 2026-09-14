<script setup lang="ts">
/**
 * "not right?" — the free correction, offered from inside the review modal.
 *
 * WHY IT LIVES HERE AND NOT IN THE READING OVERLAY
 * The overlay's resolve beat is ~700ms: far too short to read an answer and decide it is
 * wrong. The review modal is where the user has EVIDENCE — they can see what beanies made of
 * the document — which was the whole argument for the affordance.
 *
 * THE ORDER, and every step of it is load-bearing:
 *   1. `refuseIfBusy` FIRST, before the picker. `withIngestLock` is taken inside the spine,
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
import ChoiceModal from '@/components/ui/ChoiceModal.vue';
import { useAiCapability } from '@/composables/useAiCapability';
import { useDocumentConsent } from '@/composables/useDocumentConsent';
import { useToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { IN_APP_ENV, ingestInAppSource, refuseIfBusy } from '@/composables/useSharedDocumentIngest';
import { MAGIC_DESTINATIONS, MAGIC_DESTINATION_KINDS } from '@/constants/magicDestinations';
import { isReaderEnabled, readerForShareKind } from '@/composables/useMagicReader';
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

const pickerOpen = ref(false);

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
 * Every kind except the one beanies already chose, and except any whose reader this member
 * cannot reach.
 *
 * The same-kind filter is because "correcting" event to event is a no-op the server refuses
 * anyway. The READER filter matters more: the spine's reader gate runs AFTER the model has
 * answered, so offering a kind with its flag off would spend the grant, get a correct answer,
 * and then throw it away with "that reader is off". Here the user has NAMED the kind, so —
 * unlike a first read, where the kind is unknown until the model says — it can be checked in
 * advance for free.
 */
const options = computed(() =>
  MAGIC_DESTINATION_KINDS.filter(
    (kind) => kind !== props.from && isReaderEnabled(readerForShareKind(kind))
  ).map((kind) => ({
    id: kind,
    icon: MAGIC_DESTINATIONS[kind].icon,
    label: t(`ai.capture.dest.${kind}`),
  }))
);

function openPicker(): void {
  if (refuseIfBusy(IN_APP_ENV)) return;
  pickerOpen.value = true;
}

async function pick(id: string): Promise<void> {
  const to = id as ShareKind;
  pickerOpen.value = false;

  const grant = await requestConsent();
  // Declined. The grant is only ever consumed server-side, so it stays spendable and the
  // banner stays offered — a decline costs the family nothing at all.
  if (!grant) return;

  // Titled with the FEATURE, not the affordance: "Tell beanies what it is" reads as an
  // instruction when it arrives as a toast the user has just acted on.
  showToast(
    'info',
    t('ai.capture.title'),
    fillTemplate(t('ai.correct.picked'), { kind: t(`ai.capture.dest.${to}`) })
  );

  emit('close');
  await nextTick();
  void ingestInAppSource({ kind: 'correction', env: props.env, from: props.from, to }, grant);
}
</script>

<template>
  <div
    v-if="canCorrect"
    class="dark:bg-surface-overlay mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] bg-[var(--tint-slate-5)] px-3.5 py-2.5"
  >
    <p class="text-secondary-400 dark:text-ink-soft text-xs">
      {{ t('ai.correct.prompt') }}
      <span v-if="isFree" class="text-secondary-400 dark:text-ink-faint">{{
        t('ai.correct.free')
      }}</span>
    </p>
    <button
      type="button"
      class="font-outfit dark:text-accent-lift cursor-pointer text-xs font-semibold text-[#F15D22] underline underline-offset-2"
      @click="openPicker"
    >
      {{ t('ai.correct.action') }}
    </button>
  </div>

  <!-- `layer="top"` because this opens from INSIDE a review modal. At its meal-editor mount
       `RecipeFormModal` is itself z-[60]; at equal specificity source order alone would decide
       whether the picker is visible. -->
  <ChoiceModal
    :open="pickerOpen"
    layer="top"
    :title="t('ai.correct.title')"
    :options="options"
    @select="(id: string) => void pick(id)"
    @close="pickerOpen = false"
  />
</template>
