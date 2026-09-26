<script setup lang="ts">
/**
 * Who Owns What (#109): the family check-in drawer (Requirement 18, mockup section 10).
 *
 * A short agenda from `buildCheckInAgenda`, snapshotted when the drawer opens so a card
 * dealt here stays on screen with "Dealt to …" instead of vanishing mid-conversation:
 *  - **Still nobody**: Deal Now opens "Who owns it?" and deals through `useDealActions`.
 *  - **Moved since last time**: Settling In / Let's Talk.
 *  - **Haven't moved in a while** (up to 3, 90+ days): Still Works / Let's Talk / Re-deal
 *    (Re-deal opens the same picker, and is offered only when someone else could take it).
 *    An Undo from a deal's toast reopens that card here.
 * Finish records one write-once check-in with the outcome counts
 * (`store.completeCheckIn`, which fires the celebration), then the drawer shows "Deck
 * checked" with the "Let's Talk" cards listed and the next due date. No to-do is created
 * in v1. Opening the drawer logs `checkin_started` (`store.startCheckIn`), so the started
 * vs completed rate is measurable.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useToday } from '@/composables/useToday';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import {
  buildCheckInAgenda,
  ymdOf,
  type CheckInAgenda,
  type ResolvedCard,
} from '@/utils/responsibilityDeck';
import type { CheckInOutcomes } from '@/utils/responsibilityOps';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ResponsibilityCheckIn } from '@/types/models';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineMemberPicker from '@/components/ui/InlineMemberPicker.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import DeckCelebration from './DeckCelebration.vue';
import { useDealActions } from './useDealActions';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

type Outcome = 'stillWorks' | 'settling' | 'talk' | 'redeal';

const { t } = useTranslation();
const { today } = useToday();
const store = useResponsibilityStore();
const familyStore = useFamilyStore();
const { getMemberName } = useMemberInfo();
const { cardName, cardEmoji, partCaption } = useResponsibilityCardLabel();
const actions = useDealActions();

const FALLBACK_TINT = '#94A3B8';
const EMPTY_AGENDA: CheckInAgenda = { nobody: [], moved: [], unchanged: [] };

const agenda = ref<CheckInAgenda>(EMPTY_AGENDA);
const outcomes = ref<Record<string, Outcome>>({});
/** Cards dealt from this drawer: card id → who now holds it. */
const dealtTo = ref<Record<string, string>>({});
const picking = ref<{ cardId: string; reason: 'dealNow' | 'redeal' } | null>(null);
const submitting = ref(false);
const completed = ref<ResponsibilityCheckIn | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    agenda.value = buildCheckInAgenda(store.resolved, store.moves, store.checkInSince, today.value);
    outcomes.value = {};
    dealtTo.value = {};
    picking.value = null;
    completed.value = null;
    void store.startCheckIn();
  },
  { immediate: true }
);

function live(card: ResolvedCard): ResolvedCard {
  return store.cardById(card.id) ?? card;
}
function tint(card: ResolvedCard): string {
  return getListCategory(card.category)?.color ?? FALLBACK_TINT;
}

const isEmpty = computed(
  () => !agenda.value.nobody.length && !agenda.value.moved.length && !agenda.value.unchanged.length
);

function option(value: Outcome, key: UIStringKey, emoji: string) {
  return { value, label: `${emoji} ${t(key)}`, variant: 'orange' as const };
}
const movedOptions = computed(() => [
  option('settling', 'whoOwnsWhat.checkinDrawer.settling', '👍'),
  option('talk', 'whoOwnsWhat.checkinDrawer.talk', '💬'),
]);
/**
 * Who a re-deal of this card could go to: every human but the part's current holder
 * (picking them would write nothing yet toast "dealt" and count a re-deal; "Still works"
 * is the answer for keeping it where it is).
 */
function redealTargets(card: ResolvedCard) {
  const holder = live(card).parts[0]?.holderId;
  return familyStore.sortedHumans.filter((m) => m.id !== holder);
}
/** Re-deal is offered only when there is someone to re-deal to: never an empty picker. */
function unchangedOptions(card: ResolvedCard) {
  const out = [
    option('stillWorks', 'whoOwnsWhat.checkinDrawer.stillWorks', '👍'),
    option('talk', 'whoOwnsWhat.checkinDrawer.talk', '💬'),
  ];
  if (redealTargets(card).length)
    out.push(option('redeal', 'whoOwnsWhat.checkinDrawer.redeal', '🔁'));
  return out;
}

function setOutcome(cardId: string, value: string): void {
  const next = { ...outcomes.value };
  if (!value) {
    delete next[cardId];
    if (picking.value?.cardId === cardId) picking.value = null;
  } else next[cardId] = value as Outcome;
  outcomes.value = next;
  // Re-deal is an action: it asks who takes the card next.
  if (value === 'redeal' && !dealtTo.value[cardId]) picking.value = { cardId, reason: 'redeal' };
}

function heldLine(card: ResolvedCard): string {
  const c = live(card);
  const part = c.parts.find((p) => p.holderId);
  if (!part?.holderId) return '';
  const since = part.since ?? c.state?.createdAt;
  return since
    ? fillTemplate(t('whoOwnsWhat.checkinDrawer.heldSince'), {
        name: getMemberName(part.holderId, ''),
        date: formatNookDate(ymdOf(since)),
      })
    : getMemberName(part.holderId, '');
}

function movedLine(move: { fromId?: string; toId?: string; at: string }): string {
  return fillTemplate(t('whoOwnsWhat.checkinDrawer.movedLine'), {
    from: getMemberName(move.fromId, ''),
    to: getMemberName(move.toId, ''),
    date: formatNookDate(ymdOf(move.at)),
  });
}

function dealtLine(cardId: string): string {
  const who = dealtTo.value[cardId];
  return who
    ? fillTemplate(t('whoOwnsWhat.checkinDrawer.dealt'), { name: getMemberName(who, '') })
    : '';
}

// ── Picker ───────────────────────────────────────────────────────────────────
const pickingCard = computed(() =>
  picking.value ? store.cardById(picking.value.cardId) : undefined
);
/** Deal Now fills the first open part; Re-deal moves the first part. */
const pickingPart = computed(() => {
  const c = pickingCard.value;
  if (!c) return undefined;
  return picking.value?.reason === 'dealNow'
    ? (c.parts.find((p) => !p.holderId) ?? c.parts[0])
    : c.parts[0];
});
/** Who the picker offers: everyone for Deal Now, `redealTargets` for a re-deal. */
const members = computed(() =>
  picking.value?.reason === 'redeal' && pickingCard.value
    ? redealTargets(pickingCard.value)
    : familyStore.sortedHumans
);

async function onPick(memberId: string): Promise<void> {
  const c = pickingCard.value;
  const part = pickingPart.value;
  const reason = picking.value?.reason;
  if (!c || !part || !reason) return;
  // An Undo from the toast takes the deal back here too: the card is open again (Deal Now
  // shows again; a re-deal's pill clears so tapping Re-deal reopens the picker), and the
  // counts no longer include it.
  const res = await actions.deal(c.id, part.key, memberId, {
    onUndone: () => {
      if (dealtTo.value[c.id] !== memberId) return;
      const next = { ...dealtTo.value };
      delete next[c.id];
      dealtTo.value = next;
      if (reason === 'redeal') setOutcome(c.id, '');
    },
  });
  if (!res) return;
  dealtTo.value = { ...dealtTo.value, [c.id]: memberId };
  picking.value = null;
}

function onPickerCancel(): void {
  const p = picking.value;
  picking.value = null;
  if (p?.reason === 'redeal' && !dealtTo.value[p.cardId]) setOutcome(p.cardId, '');
}

// ── Finish ───────────────────────────────────────────────────────────────────
const counts = computed<CheckInOutcomes>(() => {
  const values = Object.entries(outcomes.value);
  const redealt = values.filter(([id, o]) => o === 'redeal' && dealtTo.value[id]).length;
  const nobodyIds = new Set(agenda.value.nobody.map((c) => c.id));
  return {
    stillWorks: values.filter(([, o]) => o === 'stillWorks' || o === 'settling').length,
    talkAbout: values.filter(([, o]) => o === 'talk').length,
    redealt,
    dealtNow: Object.keys(dealtTo.value).filter((id) => nobodyIds.has(id)).length,
  };
});

async function onSave(): Promise<void> {
  if (completed.value) {
    emit('close');
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    const record = await store.completeCheckIn(counts.value);
    // The store has already shown and reported any failure; stay open so nothing is lost.
    if (record) completed.value = record;
  } finally {
    submitting.value = false;
  }
}

function plural(base: string, n: number): string {
  return fillTemplate(t(`${base}.${n === 1 ? 'one' : 'other'}` as UIStringKey), { count: n });
}
const completedPills = computed(() => {
  const c = completed.value;
  if (!c) return [];
  const out: string[] = [];
  if (c.stillWorks) out.push(plural('whoOwnsWhat.checkinDrawer.count.stillWorks', c.stillWorks));
  if (c.talkAbout) out.push(plural('whoOwnsWhat.checkinDrawer.count.talk', c.talkAbout));
  if (c.redealt) out.push(plural('whoOwnsWhat.checkinDrawer.count.redealt', c.redealt));
  if (c.dealtNow) out.push(plural('whoOwnsWhat.checkinDrawer.count.dealtNow', c.dealtNow));
  return out;
});
const completedBody = computed(() => {
  const talk = Object.entries(outcomes.value)
    .filter(([, o]) => o === 'talk')
    .map(([id]) => store.cardById(id))
    .filter((c): c is ResolvedCard => !!c)
    .map((c) => cardName(c));
  const parts = [t('whoOwnsWhat.checkinDrawer.doneBody')];
  if (talk.length)
    parts.push(fillTemplate(t('whoOwnsWhat.checkinDrawer.doneTalk'), { cards: talk.join(', ') }));
  return parts.join(' ');
});
const completedNote = computed(() =>
  store.nextCheckIn
    ? fillTemplate(t('whoOwnsWhat.checkinDrawer.doneNext'), {
        date: formatNookDate(store.nextCheckIn),
      })
    : ''
);
</script>

<template>
  <BeanieFormModal
    :open="open"
    variant="drawer"
    :title="t('whoOwnsWhat.checkinDrawer.title')"
    icon="🗓️"
    :save-label="completed ? t('action.done') : t('whoOwnsWhat.checkinDrawer.finish')"
    :is-submitting="submitting"
    @close="emit('close')"
    @save="onSave"
  >
    <DeckCelebration
      v-if="completed"
      :title="t('whoOwnsWhat.checkinDrawer.doneTitle')"
      :body="completedBody"
      :pills="completedPills"
      :action-label="t('action.done')"
      :note="completedNote"
      :image-alt="t('whoOwnsWhat.pile.imageAlt')"
      data-testid="checkin-done"
      @action="emit('close')"
    />

    <template v-else>
      <p class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
        {{ t('whoOwnsWhat.checkinDrawer.intro') }}
      </p>

      <p
        v-if="isEmpty"
        class="dark:text-ink-soft py-6 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="checkin-empty"
      >
        {{ t('whoOwnsWhat.checkinDrawer.empty') }}
      </p>

      <!-- Haven't moved in a while -->
      <section v-if="agenda.unchanged.length" class="space-y-2">
        <h3 class="ci-label">{{ t('whoOwnsWhat.checkinDrawer.unchanged') }}</h3>
        <div
          v-for="card in agenda.unchanged"
          :key="card.id"
          class="ci-item"
          :data-testid="`checkin-unchanged-${card.id}`"
        >
          <div class="flex items-center gap-2.5">
            <span class="thumb" :style="{ '--cat': tint(card) }" aria-hidden="true">{{
              cardEmoji(card)
            }}</span>
            <div class="min-w-0 flex-1">
              <b class="ci-name">{{ cardName(card) }}</b>
              <small class="ci-meta">{{ dealtLine(card.id) || heldLine(card) }}</small>
            </div>
            <MemberChip
              v-if="live(card).parts[0]?.holderId"
              :member-id="live(card).parts[0]!.holderId!"
              size="sm"
            />
          </div>
          <TogglePillGroup
            :model-value="outcomes[card.id] ?? ''"
            :options="unchangedOptions(card)"
            clearable
            @update:model-value="setOutcome(card.id, $event)"
          />
          <InlineMemberPicker
            v-if="picking?.cardId === card.id && pickingCard"
            :members="members"
            :title="t('whoOwnsWhat.pile.whoOwns')"
            :subtitle="pickingPart ? partCaption(pickingCard, pickingPart) || undefined : undefined"
            :back-label="t('action.cancel')"
            :empty-message="t('whoOwnsWhat.pile.noMembers')"
            tile-testid-prefix="checkin-pick-"
            dismiss-style="close"
            @pick="onPick"
            @cancel="onPickerCancel"
          />
        </div>
      </section>

      <!-- Moved since last time -->
      <section v-if="agenda.moved.length" class="space-y-2">
        <h3 class="ci-label">{{ t('whoOwnsWhat.checkinDrawer.moved') }}</h3>
        <div
          v-for="{ card, move } in agenda.moved"
          :key="card.id"
          class="ci-item"
          :data-testid="`checkin-moved-${card.id}`"
        >
          <div class="flex items-center gap-2.5">
            <span class="thumb" :style="{ '--cat': tint(card) }" aria-hidden="true">{{
              cardEmoji(card)
            }}</span>
            <div class="min-w-0 flex-1">
              <b class="ci-name">{{ cardName(card) }}</b>
              <small class="ci-meta">{{ movedLine(move) }}</small>
            </div>
            <MemberChip v-if="move.toId" :member-id="move.toId" size="sm" />
          </div>
          <TogglePillGroup
            :model-value="outcomes[card.id] ?? ''"
            :options="movedOptions"
            clearable
            @update:model-value="setOutcome(card.id, $event)"
          />
        </div>
      </section>

      <!-- Still nobody -->
      <section v-if="agenda.nobody.length" class="space-y-2">
        <h3 class="ci-label">{{ t('whoOwnsWhat.checkinDrawer.nobody') }}</h3>
        <div
          v-for="card in agenda.nobody"
          :key="card.id"
          class="ci-item is-open"
          :data-testid="`checkin-nobody-${card.id}`"
        >
          <div class="flex items-center gap-2.5">
            <span class="thumb" :style="{ '--cat': tint(card) }" aria-hidden="true">{{
              cardEmoji(card)
            }}</span>
            <div class="min-w-0 flex-1">
              <b class="ci-name">{{ cardName(card) }}</b>
              <small v-if="dealtTo[card.id]" class="ci-meta">{{ dealtLine(card.id) }}</small>
            </div>
            <button
              v-if="!dealtTo[card.id]"
              type="button"
              class="font-outfit text-primary-500 dark:text-accent-lift shrink-0 rounded-full bg-[var(--tint-orange-8)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--tint-orange-15)] dark:hover:bg-[var(--tint-orange-15)]"
              :data-testid="`checkin-deal-${card.id}`"
              @click="picking = { cardId: card.id, reason: 'dealNow' }"
            >
              {{ t('whoOwnsWhat.checkinDrawer.dealNow') }}
            </button>
            <span v-else aria-hidden="true">✅</span>
          </div>
          <InlineMemberPicker
            v-if="picking?.cardId === card.id && pickingCard"
            :members="members"
            :title="t('whoOwnsWhat.pile.whoOwns')"
            :subtitle="pickingPart ? partCaption(pickingCard, pickingPart) || undefined : undefined"
            :back-label="t('action.cancel')"
            :empty-message="t('whoOwnsWhat.pile.noMembers')"
            tile-testid-prefix="checkin-pick-"
            dismiss-style="close"
            @pick="onPick"
            @cancel="onPickerCancel"
          />
        </div>
      </section>
    </template>
  </BeanieFormModal>
</template>

<style scoped>
.ci-label {
  color: var(--color-text-muted);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

html.dark .ci-label {
  color: var(--color-ink-faint);
}

.ci-item {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 1rem;
  box-shadow: var(--card-shadow);
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
}

html.dark .ci-item {
  background: var(--color-surface-overlay);
  border-color: var(--color-line);
}

.ci-item.is-open {
  border-style: dashed;
  border-width: 1.5px;
  box-shadow: none;
}

html.dark .ci-item.is-open {
  border-color: var(--color-line-strong);
}

.ci-name {
  color: var(--color-text);
  display: block;
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.2;
}

html.dark .ci-name {
  color: var(--color-ink);
}

.ci-meta {
  color: var(--color-text-muted);
  display: block;
  font-size: 0.75rem;
}

html.dark .ci-meta {
  color: var(--color-ink-faint);
}

.thumb {
  background: color-mix(in srgb, var(--cat) 14%, transparent);
  border-radius: 0.5625rem;
  display: grid;
  flex: none;
  font-size: 1rem;
  height: 2rem;
  place-items: center;
  width: 2rem;
}

html.dark .thumb {
  background: color-mix(in srgb, var(--cat) 24%, transparent);
}
</style>
