<script setup lang="ts">
/**
 * Who Owns What (#109): the family check-in drawer (Requirement 18, mockup section 10).
 *
 * A short agenda from `buildCheckInAgenda`, snapshotted when the drawer opens so a card
 * dealt here stays on screen with "Dealt to …" instead of vanishing mid-conversation:
 *  - **Saved from last time**: cards the last check-in saved; pre-selected Save for Next
 *    Time (not clearable), so a saved card only leaves when someone answers it.
 *  - **Haven't moved in a while** (up to 3, 90+ days): No Issues / We've Talked / Save for
 *    Next Time / Re-deal (Re-deal opens the picker; offered only when someone else could
 *    take it). An Undo from a deal's toast reopens that card here.
 *  - **Moved since last time**: No Issues / We've Talked / Save for Next Time.
 *  - **Still to deal**: kept cards with nobody (Deal Now), and a line for never-sorted ones.
 * Finish records one write-once check-in: the counts plus `talkedIds` / `savedIds`
 * (`store.completeCheckIn`, which fires the celebration). The done screen names what was
 * saved, and offers "Deal the Remaining N" (the page opens the deal pile) when cards are left. Opening the drawer logs `checkin_started` (`store.startCheckIn`), so the started
 * vs completed rate is measurable.
 */
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useToday } from '@/composables/useToday';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { categoryTint } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import {
  buildCheckInAgenda,
  checkInCardIds,
  otherHumans,
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
import CardArt from '@/components/responsibilities/CardArt.vue';
import DeckCelebration from './DeckCelebration.vue';
import { useDealActions } from './useDealActions';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; 'deal-remaining': [] }>();

/**
 * The answers (greg, 2026-09-28): No Issues and We've Talked close a card out (We've Talked is
 * written to the record and shows in the card's history); Save for Next Time brings it back at
 * the next check-in. Re-deal (long-unchanged cards) hands it to someone else.
 */
type Outcome = 'noIssues' | 'talked' | 'saved' | 'redeal';
type SectionId = 'saved' | 'unchanged' | 'moved' | 'nobody';

const { t } = useTranslation();
const { today } = useToday();
const store = useResponsibilityStore();
const familyStore = useFamilyStore();
const { getMemberName } = useMemberInfo();
const { cardName, partCaption, heldSince } = useResponsibilityCardLabel();
const actions = useDealActions();

const EMPTY_AGENDA: CheckInAgenda = { saved: [], nobody: [], moved: [], unchanged: [] };

const agenda = ref<CheckInAgenda>(EMPTY_AGENDA);
const outcomes = ref<Record<string, Outcome>>({});
/** Cards dealt from this drawer: card id → who now holds it. */
const dealtTo = ref<Record<string, string>>({});
/** The ROW (section + card) whose picker is open: a card can sit in two sections. */
const picking = ref<{ rowKey: string; cardId: string; reason: 'dealNow' | 'redeal' } | null>(null);
const submitting = ref(false);
const completed = ref<ResponsibilityCheckIn | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    agenda.value = buildCheckInAgenda(store.resolved, store.moves, store.checkInSince, today.value);
    // A saved card stays saved unless someone answers it: it never drops off silently.
    outcomes.value = Object.fromEntries(agenda.value.saved.map((c) => [c.id, 'saved' as const]));
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

/**
 * Who a re-deal of this card could go to: every human but the part's current holder
 * (picking them would write nothing yet toast "dealt" and count a re-deal; No Issues is the
 * answer for keeping it where it is).
 */
function redealTargets(card: ResolvedCard) {
  return otherHumans(familyStore.sortedHumans, live(card));
}

function heldLine(card: ResolvedCard): string {
  const c = live(card);
  const part = c.parts.find((p) => p.holderId);
  const held = part ? heldSince(c, part) : null;
  if (!held) return '';
  return held.date ? fillTemplate(t('whoOwnsWhat.checkinDrawer.heldSince'), held) : held.name;
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

// ── Sections: ONE list, one row template ─────────────────────────────────────
interface Row {
  key: string;
  card: ResolvedCard;
  meta: string;
  holderId?: string;
  kind: 'outcome' | 'deal';
  /** Offer Re-deal (long-unchanged cards, when someone else could take it). */
  redeal: boolean;
}
interface Section {
  id: SectionId;
  rows: Row[];
}
const SECTION_TITLE: Record<SectionId, UIStringKey> = {
  saved: 'whoOwnsWhat.checkinDrawer.saved',
  unchanged: 'whoOwnsWhat.checkinDrawer.unchanged',
  moved: 'whoOwnsWhat.checkinDrawer.moved',
  nobody: 'whoOwnsWhat.checkinDrawer.toDeal',
};

const sections = computed<Section[]>(() => {
  const a = agenda.value;
  const row = (id: SectionId, card: ResolvedCard, extra: Partial<Row>): Row => ({
    key: `${id}-${card.id}`,
    card,
    meta: '',
    kind: 'outcome',
    redeal: false,
    ...extra,
  });
  const holder = (c: ResolvedCard) => live(c).parts[0]?.holderId;
  const all: Section[] = [
    {
      id: 'saved',
      rows: a.saved.map((c) =>
        row('saved', c, { meta: dealtLine(c.id) || heldLine(c), holderId: holder(c) })
      ),
    },
    {
      id: 'unchanged',
      rows: a.unchanged.map((c) =>
        row('unchanged', c, {
          meta: dealtLine(c.id) || heldLine(c),
          holderId: holder(c),
          redeal: redealTargets(c).length > 0,
        })
      ),
    },
    {
      id: 'moved',
      rows: a.moved.map(({ card, move }) =>
        row('moved', card, { meta: movedLine(move), holderId: move.toId })
      ),
    },
    {
      id: 'nobody',
      rows: a.nobody.map((c) => row('nobody', c, { meta: dealtLine(c.id), kind: 'deal' })),
    },
  ];
  // "Still to Deal" also shows when only never-sorted cards are left (the count line).
  return all.filter((sec) => sec.rows.length || (sec.id === 'nobody' && store.stats.unsorted > 0));
});

const isEmpty = computed(() => !sections.value.length);

function option(value: Outcome, key: UIStringKey, emoji: string) {
  return { value, label: `${emoji} ${t(key)}`, variant: 'orange' as const };
}
const ANSWERS = computed(() => [
  option('noIssues', 'whoOwnsWhat.checkinDrawer.noIssues', '👍'),
  option('talked', 'whoOwnsWhat.checkinDrawer.talked', '💬'),
  option('saved', 'whoOwnsWhat.checkinDrawer.saveNext', '📌'),
]);
const REDEAL = computed(() => option('redeal', 'whoOwnsWhat.checkinDrawer.redeal', '🔁'));
function optionsFor(row: Row) {
  return row.redeal ? [...ANSWERS.value, REDEAL.value] : ANSWERS.value;
}

/** A card re-dealt in this drawer: its answer stays Re-deal (only the toast's Undo frees it). */
function isRedealt(cardId: string): boolean {
  return outcomes.value[cardId] === 'redeal' && !!dealtTo.value[cardId];
}

function writeOutcome(cardId: string, value: Outcome | ''): void {
  const next = { ...outcomes.value };
  if (!value) delete next[cardId];
  else next[cardId] = value;
  outcomes.value = next;
}

/**
 * The ONE rule for a re-deal picker going away without a deal (cancelled, or replaced by
 * another row's picker): its Re-deal answer is cleared, so no card is left on "Re-deal" with
 * nothing recorded.
 */
function abandonRedeal(p: { cardId: string; reason: 'dealNow' | 'redeal' } | null): void {
  if (p?.reason === 'redeal' && !dealtTo.value[p.cardId]) writeOutcome(p.cardId, '');
}

/** Open a picker in one row, abandoning any other card's undealt re-deal picker. */
function openPicker(next: { rowKey: string; cardId: string; reason: 'dealNow' | 'redeal' }): void {
  const p = picking.value;
  if (p && p.cardId !== next.cardId) abandonRedeal(p);
  picking.value = next;
}

function setOutcome(row: Pick<Row, 'key' | 'card'>, value: string): void {
  const cardId = row.card.id;
  // The deal happened: the record must count it as re-dealt (the row hides its answers).
  if (isRedealt(cardId)) return;
  writeOutcome(cardId, value as Outcome | '');
  // Leaving Re-deal closes THIS card's re-deal picker; a Deal Now picker is never touched.
  const p = picking.value;
  if (p?.reason === 'redeal' && p.cardId === cardId && value !== 'redeal') picking.value = null;
  // Re-deal is an action: it asks who takes the card next.
  if (value === 'redeal' && !dealtTo.value[cardId])
    openPicker({ rowKey: row.key, cardId, reason: 'redeal' });
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
  const p = picking.value;
  if (!c || !part || !p) return;
  const { reason, rowKey } = p;
  // An Undo from the toast takes the deal back here too: the card is open again (Deal Now
  // shows again; a re-deal's pill clears so tapping Re-deal reopens the picker), and the
  // counts no longer include it.
  const res = await actions.deal(c.id, part.key, memberId, {
    onUndone: () => {
      if (dealtTo.value[c.id] !== memberId) return;
      const next = { ...dealtTo.value };
      delete next[c.id];
      dealtTo.value = next;
      if (reason === 'redeal') writeOutcome(c.id, '');
    },
  });
  if (!res) return;
  dealtTo.value = { ...dealtTo.value, [c.id]: memberId };
  // Whatever was tapped while the deal saved, a re-dealt card records as Re-deal.
  if (reason === 'redeal') writeOutcome(c.id, 'redeal');
  // Close only this row's picker: another one opened meanwhile stays open.
  if (picking.value?.rowKey === rowKey) picking.value = null;
}

function onPickerCancel(): void {
  const p = picking.value;
  picking.value = null;
  abandonRedeal(p);
}

// ── Finish ───────────────────────────────────────────────────────────────────
const counts = computed<CheckInOutcomes>(() => {
  const values = Object.entries(outcomes.value);
  const ids = (o: Outcome) => values.filter(([, v]) => v === o).map(([id]) => id);
  const nobodyIds = new Set(agenda.value.nobody.map((c) => c.id));
  return {
    stillWorks: ids('noIssues').length,
    talkedIds: ids('talked'),
    savedIds: ids('saved'),
    redealt: ids('redeal').filter((id) => dealtTo.value[id]).length,
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
    if (!record) return;
    completed.value = record;
    // The record counts the deck as it stands now: a deal's Undo after this would revert a
    // card the record still counts, so retire it.
    actions.dismissLiveUndo();
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
  const saved = checkInCardIds(c, 'savedIds').length;
  const out: string[] = [];
  if (c.stillWorks) out.push(plural('whoOwnsWhat.checkinDrawer.count.noIssues', c.stillWorks));
  if (c.talkAbout) out.push(plural('whoOwnsWhat.checkinDrawer.count.talked', c.talkAbout));
  if (saved) out.push(plural('whoOwnsWhat.checkinDrawer.count.saved', saved));
  if (c.redealt) out.push(plural('whoOwnsWhat.checkinDrawer.count.redealt', c.redealt));
  if (c.dealtNow) out.push(plural('whoOwnsWhat.checkinDrawer.count.dealtNow', c.dealtNow));
  return out;
});
const completedBody = computed(() => {
  const c = completed.value;
  const saved = c
    ? checkInCardIds(c, 'savedIds')
        .map((id) => store.cardById(id))
        .filter((card): card is ResolvedCard => !!card)
        .map((card) => cardName(card))
    : [];
  const parts = [t('whoOwnsWhat.checkinDrawer.doneBody')];
  if (saved.length)
    parts.push(fillTemplate(t('whoOwnsWhat.checkinDrawer.doneSaved'), { cards: saved.join(', ') }));
  return parts.join(' ');
});
const completedNote = computed(() =>
  store.nextCheckIn
    ? fillTemplate(t('whoOwnsWhat.checkinDrawer.doneNext'), {
        date: formatNookDate(store.nextCheckIn),
      })
    : ''
);
/** After Finish: "Deal the Remaining N" when cards are still to deal, else Done. */
const doneAction = computed(() =>
  store.remaining > 0
    ? plural('whoOwnsWhat.overview.dealRemaining', store.remaining)
    : t('action.done')
);
function onDoneAction(): void {
  if (store.remaining > 0) emit('deal-remaining');
  else emit('close');
}
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
      :action-label="doneAction"
      :note="completedNote"
      :image-alt="t('whoOwnsWhat.pile.imageAlt')"
      data-testid="checkin-done"
      @action="onDoneAction"
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

      <section
        v-for="section in sections"
        :key="section.id"
        class="space-y-2"
        :data-testid="`checkin-section-${section.id}`"
      >
        <h3 class="ci-label">{{ t(SECTION_TITLE[section.id]) }}</h3>
        <div
          v-for="row in section.rows"
          :key="row.key"
          class="ci-item"
          :class="{ 'is-open': row.kind === 'deal' }"
          :data-testid="`checkin-${row.key}`"
        >
          <div class="flex items-center gap-2.5">
            <span
              class="thumb"
              :style="{ '--cat': categoryTint(row.card.category) }"
              aria-hidden="true"
              ><CardArt :card="row.card" img-class="h-full w-full"
            /></span>
            <div class="min-w-0 flex-1">
              <b class="ci-name">{{ cardName(row.card) }}</b>
              <small v-if="row.meta" class="ci-meta">{{ row.meta }}</small>
            </div>
            <template v-if="row.kind === 'deal'">
              <button
                v-if="!dealtTo[row.card.id]"
                type="button"
                class="font-outfit text-primary-500 dark:text-accent-lift shrink-0 rounded-full bg-[var(--tint-orange-8)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--tint-orange-15)] dark:hover:bg-[var(--tint-orange-15)]"
                :data-testid="`checkin-deal-${row.card.id}`"
                @click="openPicker({ rowKey: row.key, cardId: row.card.id, reason: 'dealNow' })"
              >
                {{ t('whoOwnsWhat.checkinDrawer.dealNow') }}
              </button>
              <span v-else aria-hidden="true">✅</span>
            </template>
            <MemberChip v-else-if="row.holderId" :member-id="row.holderId" size="sm" />
          </div>
          <!-- Three or four answers: wrap rather than run past the drawer's edge. -->
          <TogglePillGroup
            v-if="row.kind === 'outcome' && !isRedealt(row.card.id)"
            class="max-w-full flex-wrap"
            :model-value="outcomes[row.card.id] ?? ''"
            :options="optionsFor(row)"
            :clearable="section.id !== 'saved'"
            @update:model-value="setOutcome(row, $event)"
          />
          <InlineMemberPicker
            v-if="picking?.rowKey === row.key && pickingCard"
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
        <p
          v-if="section.id === 'nobody' && store.stats.unsorted > 0"
          class="dark:text-ink-faint px-1 text-xs text-[var(--color-text-muted)]"
          data-testid="checkin-unsorted"
        >
          {{ plural('whoOwnsWhat.checkinDrawer.unsorted', store.stats.unsorted) }}
        </p>
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
