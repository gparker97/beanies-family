<script setup lang="ts">
/**
 * Who Owns What (#109): the card's view drawer (Requirement 12), the same view-first
 * pattern as activities and transactions.
 *
 * Opens on the card itself, in hand: the deal pile's own stage (`DealPileStage`,
 * `size="hand"`) with its owner on the card, so opening a card feels like holding
 * the one you were dealt (plan `2026-09-28-deal-board-and-card-in-hand.md`). Arrows, ← →
 * and a swipe step through the list it was opened from (`sequence`: a Deck shelf, a bean's
 * cards, a board lane, Skipped, the Overview's Waiting rows); "<list> · n of N" says where
 * you are.
 *
 * The card stays pure (greg, 2026-09-28): art, name, done line, category and who holds
 * it. Everything else sits below it: how a split card is split (each part and its holder),
 * the card's full history (added, every deal and hand-over, skipped; `cardHistory`), and
 * what beanies uses the card for.
 *
 * Footer for grown-ups: the delete tile (family-made cards) or the DISABLED tile with its
 * (i) reason (built-in cards, which are skipped rather than deleted), an outlined Edit,
 * and Close. Children get Close only: the drawer is view-only for them.
 *
 * A card reminder (#123) shows as a tear-off stub on the card face ("🔔 weekly on Wed at
 * 8pm"; per held part on a split card, "No reminder" for a part without one; nothing when
 * the card has none). Below the card, a single card gets a Reminder field (the summary, what
 * it says and to whom, and the live to-do through `LinkedTodoRow`, the card side's one to-do
 * resolver, so this drawer never reads `todoStore`); a split card says it in each part's row.
 *
 * If the card disappears while open (deleted or restored on another device) the drawer
 * says so and closes, rather than rendering an empty shell. A delete from this drawer's
 * own tile is not a surprise: it has its own success toast, so the notice is skipped.
 */
import { computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ModalSecondaryButton from '@/components/ui/ModalSecondaryButton.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import CardBack from '@/components/responsibilities/CardBack.vue';
import DealPileStage from '@/components/responsibilities/DealPileStage.vue';
import LinkedTodoRow from '@/components/todo/LinkedTodoRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import { isAdultMember, useMemberInfo } from '@/composables/useMemberInfo';
import { formatNookDate, formatTime12 } from '@/utils/date';
import { cadenceToRule } from '@/services/recurrence/cadence';
import { cardTodoId } from '@/utils/cardReminders';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { createChangeGate } from '@/services/telemetry/emitPolicy';
import { cardUsesFor } from '@/constants/responsibilityCards';
import { getListTemplateByKey } from '@/constants/listTemplates';
import { SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import { fillTemplate } from '@/utils/fillTemplate';
import { uiLocale } from '@/utils/uiLocale';
import {
  MAIN_PART_KEY,
  cardHistory,
  sequenceStep,
  ymdOf,
  type CardHistoryKind,
  type CardSequence,
} from '@/utils/responsibilityDeck';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { CardReminder } from '@/types/models';
import { useCardDrawerEnd } from './useCardDeletion';

const props = withDefaults(
  defineProps<{
    open: boolean;
    cardId: string | null;
    /** The list the card was opened from; null (a deep link) means no stepping. */
    sequence?: CardSequence | null;
    /** Grown-ups can edit and delete; children view only. */
    canEdit?: boolean;
  }>(),
  { sequence: null, canEdit: false }
);
const emit = defineEmits<{ close: []; edit: [cardId: string]; navigate: [cardId: string] }>();

const { t, currentLanguage } = useTranslation();
const store = useResponsibilityStore();
const { holderLines } = useResponsibilityCardLabel();
const { describeWithTime } = useRecurrenceLabel();
const { getMemberById, getMemberName } = useMemberInfo();
const { memberAvatarBindings } = useMemberAvatarBindings();

const card = computed(() => (props.cardId ? store.cardById(props.cardId) : undefined));

const statusLabel = computed(() => {
  if (card.value?.status === 'skipped') return t('whoOwnsWhat.card.skipped');
  if (card.value?.status === 'unsorted') return t('whoOwnsWhat.card.unsorted');
  return '';
});

const isKept = computed(() => card.value?.status === 'held' || card.value?.status === 'waiting');

/** Every part with its holder: the split list below, and (deduplicated) the owner on the card. */
const parts = computed(() => {
  const c = card.value;
  if (!c || !isKept.value) return [];
  return holderLines(c).map((line) => ({ ...line, member: getMemberById(line.memberId) }));
});

/** On the card: who holds it (each holder once), or the status. Nothing else. */
const owners = computed(() => [
  ...new Map(parts.value.flatMap((p) => (p.member ? [[p.member.id, p.member]] : []))).values(),
]);
/** "greg and Sofia" / "格雷格和米娅": the locale's own list, never an English comma. */
function listNames(names: string[]): string {
  try {
    return new Intl.ListFormat(uiLocale(currentLanguage.value), {
      style: 'long',
      type: 'conjunction',
    }).format(names);
  } catch {
    // Intl.ListFormat is missing on very old browsers: a plain list still reads fine.
    return names.join(', ');
  }
}
const ownerText = computed(() =>
  owners.value.length
    ? fillTemplate(t('whoOwnsWhat.details.heldByName'), {
        name: listNames(owners.value.map((m) => m.name)),
      })
    : ''
);

/** Below the card: a split card's parts, each with its holder (or Nobody Yet). */
const splitLines = computed(() => (card.value?.splitMode === 'single' ? [] : parts.value));
const splitTitle = computed(() =>
  card.value?.splitMode === 'child'
    ? t('whoOwnsWhat.card.splitChild')
    : t('whoOwnsWhat.card.splitLabel')
);

// ── Reminders (#123) ─────────────────────────────────────────────────────────
/** A part's reminder (only well-formed ones resolve), by part key. */
function partReminder(key: string): CardReminder | undefined {
  return card.value?.parts.find((p) => p.key === key)?.reminder;
}
/** The shared cadence wording plus its time: "weekly on Wed at 8pm". */
function reminderSummary(r: CardReminder): string {
  return describeWithTime(cadenceToRule(r.cadence), r.anchor, r.time, 'card');
}

/**
 * The stub on the card face: the single card's reminder, or one line per HELD part of a
 * split card (its own reminder, or "No reminder"). Empty (no stub) when no part reminds.
 */
const stubLines = computed(() => {
  if (!parts.value.some((p) => partReminder(p.key))) return [];
  const split = card.value?.splitMode !== 'single';
  return parts.value
    .filter((p) => !split || p.memberId)
    .map((p) => {
      const r = partReminder(p.key);
      return { key: p.key, caption: p.caption, summary: r ? reminderSummary(r) : '' };
    });
});

/** The single card's Reminder field below the card; null on a split or un-kept card. */
const singleReminder = computed(() => {
  const c = card.value;
  const part = parts.value[0];
  if (!c || c.splitMode !== 'single' || !part) return null;
  const r = partReminder(part.key);
  const holder = part.member;
  let hint = '';
  if (r && holder) {
    hint = r.time
      ? fillTemplate(t('whoOwnsWhat.reminder.goesOn'), {
          say: r.say,
          name: holder.name,
          time: formatTime12(r.time),
        })
      : fillTemplate(t('whoOwnsWhat.reminder.goesOnAllDay'), { say: r.say, name: holder.name });
  } else if (r) {
    hint = t('whoOwnsWhat.reminder.hintNobody');
  }
  return {
    reminder: r ?? null,
    summary: r ? reminderSummary(r) : '',
    hint,
    adultsSee: !!r && !!holder && !isAdultMember(holder),
    todoId: cardTodoId(c.id, part.key),
  };
});
/** Children see the field only when there is a reminder to read (no "edit it" hint). */
const showReminderField = computed(
  () => !!singleReminder.value && (!!singleReminder.value.reminder || props.canEdit)
);

/** A split row's reminder line: "🔔 Reminds Dan: weekly on Wed at 8pm", or the summary alone. */
function splitReminderText(line: { key: string; memberId: string | null }): string {
  const r = partReminder(line.key);
  if (!r) return '';
  const cadence = reminderSummary(r);
  return line.memberId
    ? fillTemplate(t('whoOwnsWhat.reminder.remindsHolder'), {
        name: getMemberName(line.memberId, ''),
        cadence,
      })
    : cadence;
}

// ── History: everything that happened to the card, newest first ─────────────
const HISTORY_KEYS: Record<CardHistoryKind, UIStringKey> = {
  dealt: 'whoOwnsWhat.history.dealt',
  moved: 'whoOwnsWhat.history.moved',
  cleared: 'whoOwnsWhat.history.cleared',
  sorted: 'whoOwnsWhat.history.sorted',
  talked: 'whoOwnsWhat.history.talked',
};

/**
 * The part a move was on, from the move ITSELF (the card may have been re-split since): the
 * label it had, or "for <child>" for a child split; '' for an unsplit card's moves.
 */
function moveCaption(partKey?: string, partLabel?: string): string {
  if (!partKey || partKey === MAIN_PART_KEY) return '';
  if (partLabel) return partLabel;
  const child = getMemberById(partKey);
  return child ? fillTemplate(t('whoOwnsWhat.card.forChild'), { name: child.name }) : '';
}
const history = computed(() => {
  const c = card.value;
  if (!c) return [];
  const who = (id?: string) => getMemberName(id, t('whoOwnsWhat.history.someone'));
  return cardHistory(c, store.moves, store.checkIns).map((e, i) => {
    return {
      key: `${e.at}:${e.kind}:${i}`,
      date: formatNookDate(ymdOf(e.at)),
      part: moveCaption(e.partKey, e.partLabel),
      text: fillTemplate(t(HISTORY_KEYS[e.kind]), { from: who(e.fromId), to: who(e.toId) }),
    };
  });
});

// ── Stepping through the list it was opened from ─────────────────────────────
const step = computed(() => {
  if (!props.cardId || !props.sequence) return null;
  const existing = new Set(store.resolved.map((c) => c.id));
  return sequenceStep(props.sequence, props.cardId, (id) => existing.has(id));
});
const position = computed(() =>
  step.value && props.sequence
    ? fillTemplate(t('whoOwnsWhat.details.position'), {
        list: props.sequence.label,
        n: step.value.n,
        total: step.value.total,
      })
    : ''
);

type StepInput = 'arrow' | 'key' | 'swipe';
// One gate per drawer: every change of input is logged, plus a heartbeat on repeats.
const navGate = createChangeGate();

/** Step to the previous / next card; false (nothing done) at the ends or without a list. */
function go(dir: -1 | 1, input: StepInput): boolean {
  const target = dir < 0 ? step.value?.prevId : step.value?.nextId;
  if (!target) return false;
  if (navGate(input)) {
    logEvent({
      level: 'info',
      surface: 'responsibilities',
      message: 'card_view_navigate',
      context: { detail: input },
    });
  }
  emit('navigate', target);
  return true;
}

useKeyboardShortcuts(
  { arrowleft: () => go(-1, 'key'), arrowright: () => go(1, 'key') },
  {
    enabled: () => props.open && !!step.value,
    tag: 'CardViewDrawer',
    // The drawer is one overlay + one Escape layer itself (BaseSidePanel →
    // useFullscreenOverlay); keys pause only under something opened on top of it.
    overlayDepth: 1,
    onError: (key, err) =>
      logEvent({
        level: 'warn',
        surface: 'responsibilities',
        message: 'card_view_shortcut_error',
        context: { detail: key },
        error: err,
      }),
  }
);

/** "beanies uses this card for": one line per default target; hint targets collapse to one. */
const uses = computed(() => {
  if (!card.value || card.value.isCustom) return [];
  const out: string[] = [];
  let hint = false;
  for (const target of cardUsesFor(card.value.id)) {
    if (target.kind === 'mealSlot') {
      out.push(
        fillTemplate(t('whoOwnsWhat.details.useMeal'), {
          slot: t(SLOT_LABEL_KEYS[target.slot]).toLocaleLowerCase(),
        })
      );
    } else if (target.kind === 'listTemplate') {
      const tpl = getListTemplateByKey(target.key);
      if (tpl) out.push(fillTemplate(t('whoOwnsWhat.details.useList'), { list: t(tpl.nameKey) }));
    } else if (target.kind === 'hint' && !hint) {
      hint = true;
      out.push(t('whoOwnsWhat.details.useHint'));
    }
  }
  return out;
});

const { onDelete } = useCardDrawerEnd({
  card,
  isOpen: () => props.open,
  close: () => emit('close'),
  source: 'CardViewDrawer',
});
</script>

<template>
  <BeanieFormModal
    :open="open && !!card"
    variant="drawer"
    :title="t('whoOwnsWhat.details.title')"
    :save-label="t('action.close')"
    :show-delete="canEdit && !!card?.isCustom"
    :delete-disabled-reason="
      canEdit && card && !card.isCustom ? t('whoOwnsWhat.details.builtInDelete') : undefined
    "
    @close="emit('close')"
    @save="emit('close')"
    @delete="onDelete"
  >
    <template #icon>
      <span class="deck-fan relative block h-7 w-7" aria-hidden="true">
        <CardBack small class="fan fan-back" />
        <CardBack small class="fan fan-front" />
      </span>
    </template>
    <template v-if="card">
      <p
        v-if="position"
        class="font-outfit dark:text-ink-faint text-center text-xs font-semibold text-[var(--color-text-muted)]"
        data-testid="card-view-position"
      >
        {{ position }}
      </p>
      <!-- The stage owns the swipe (touch / pen), emitting step(dir, 'arrow' | 'swipe'). -->
      <div class="pt-2 pb-4">
        <DealPileStage
          :card="card"
          size="hand"
          testid="card-view"
          :arrows="!!step"
          :can-prev="!!step?.prevId"
          :can-next="!!step?.nextId"
          @step="go"
        >
          <div
            class="dark:border-line mt-1 flex min-w-0 items-center gap-2 border-t border-dashed border-[var(--color-border)] pt-2"
            data-testid="card-view-owner"
          >
            <template v-if="ownerText">
              <span class="flex shrink-0 -space-x-1.5">
                <BeanieAvatar
                  v-for="m in owners"
                  :key="m.id"
                  v-bind="memberAvatarBindings(m)"
                  size="xs"
                />
              </span>
              <span class="dark:text-ink min-w-0 text-xs leading-snug text-[var(--color-text)]">{{
                ownerText
              }}</span>
            </template>
            <span
              v-else-if="statusLabel"
              class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
              >{{ statusLabel }}</span
            >
            <span v-else class="nobody-chip">{{ t('whoOwnsWhat.deck.nobody') }}</span>
          </div>
          <!-- #123: the reminder, printed on the card as a tear-off stub. -->
          <div
            v-if="stubLines.length"
            class="reminder-stub font-outfit flex flex-col gap-1"
            data-testid="card-view-stub"
          >
            <p
              v-for="line in stubLines"
              :key="line.key"
              class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-snug"
              :class="line.caption ? 'text-xs' : 'text-sm'"
            >
              <span
                v-if="line.caption"
                class="dark:text-ink-soft font-semibold text-[var(--color-text)]"
                >{{ line.caption }}</span
              >
              <span v-if="line.summary" class="dark:text-ink font-semibold text-[var(--color-text)]"
                ><span class="text-primary-500 dark:text-accent-lift" aria-hidden="true">🔔</span>
                {{ line.summary }}</span
              >
              <span v-else class="dark:text-ink-faint font-medium text-[var(--color-text-muted)]">{{
                t('whoOwnsWhat.reminder.partNone')
              }}</span>
            </p>
          </div>
        </DealPileStage>
      </div>

      <FormFieldGroup
        v-if="showReminderField && singleReminder"
        :label="t('whoOwnsWhat.reminder.field')"
      >
        <div v-if="singleReminder.reminder" class="space-y-2.5" data-testid="card-view-reminder">
          <div class="flex items-start gap-2.5">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-base"
              aria-hidden="true"
              >🔔</span
            >
            <div class="min-w-0">
              <p class="font-outfit dark:text-ink text-base font-semibold text-[var(--color-text)]">
                {{ singleReminder.summary }}
              </p>
              <p
                v-if="singleReminder.hint"
                class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]"
              >
                {{ singleReminder.hint }}
              </p>
              <p
                v-if="singleReminder.adultsSee"
                class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
                data-testid="card-view-reminder-adults"
              >
                {{ t('whoOwnsWhat.reminder.adultsSee') }}
              </p>
            </div>
          </div>
          <LinkedTodoRow :todo-id="singleReminder.todoId" @open="emit('close')" />
        </div>
        <div v-else data-testid="card-view-reminder-none">
          <p class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
            {{ t('whoOwnsWhat.reminder.none') }}
          </p>
          <p class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
            {{ t('whoOwnsWhat.reminder.editHint') }}
          </p>
        </div>
      </FormFieldGroup>

      <FormFieldGroup v-if="splitLines.length" :label="splitTitle">
        <ul class="space-y-2" data-testid="card-view-split">
          <li
            v-for="line in splitLines"
            :key="line.key"
            class="dark:bg-surface-overlay flex flex-wrap items-center gap-2 rounded-xl bg-[var(--tint-slate-5)] px-3 py-2"
          >
            <span
              class="font-outfit dark:text-ink-soft text-sm font-semibold text-[var(--color-text)]"
              >{{ line.caption }}</span
            >
            <span class="ml-auto">
              <MemberChip v-if="line.memberId" :member-id="line.memberId" size="sm" />
              <span v-else class="nobody-chip">{{ t('whoOwnsWhat.deck.nobody') }}</span>
            </span>
            <span
              v-if="splitReminderText(line)"
              class="dark:text-ink-soft w-full text-sm text-[var(--color-text)]"
              data-testid="card-view-split-reminder"
              ><span class="text-primary-500 dark:text-accent-lift" aria-hidden="true">🔔</span>
              {{ splitReminderText(line) }}</span
            >
            <span
              v-else
              class="dark:text-ink-faint w-full text-sm text-[var(--color-text-muted)]"
              data-testid="card-view-split-reminder-none"
              >{{ t('whoOwnsWhat.reminder.partNone') }}</span
            >
          </li>
        </ul>
      </FormFieldGroup>

      <FormFieldGroup v-if="history.length" :label="t('whoOwnsWhat.history.title')">
        <ol class="history space-y-2" data-testid="card-view-history">
          <li v-for="entry in history" :key="entry.key" class="flex items-baseline gap-3 text-sm">
            <span
              class="dark:text-ink-faint w-[4.5rem] shrink-0 text-xs text-[var(--color-text-muted)] tabular-nums"
              >{{ entry.date }}</span
            >
            <span class="dark:text-ink min-w-0 text-[var(--color-text)]">
              <b
                v-if="entry.part"
                class="font-outfit dark:text-ink-soft mr-1 font-semibold text-[var(--color-text)]"
                >{{ entry.part }}:</b
              >{{ entry.text }}
            </span>
          </li>
        </ol>
      </FormFieldGroup>

      <FormFieldGroup v-if="uses.length" :label="t('whoOwnsWhat.details.usesFor')">
        <ul class="space-y-2">
          <li
            v-for="line in uses"
            :key="line"
            class="dark:bg-surface-overlay dark:text-ink-soft rounded-xl bg-[var(--tint-silk-10)] px-3 py-2 text-sm text-[var(--color-text)]"
          >
            {{ line }}
          </li>
        </ul>
      </FormFieldGroup>
    </template>

    <template #footer-start>
      <ModalSecondaryButton
        v-if="canEdit && card"
        data-testid="card-view-edit"
        @click="emit('edit', card.id)"
      >
        ✏️ {{ t('action.edit') }}
      </ModalSecondaryButton>
    </template>
  </BeanieFormModal>
</template>

<style scoped>
.fan {
  height: 1.5rem;
  left: 0.25rem;
  position: absolute;
  top: 0.125rem;
  width: 1.0625rem;
}

.fan-back {
  transform: rotate(-12deg) translateX(-0.25rem);
}

.fan-front {
  transform: rotate(10deg) translateX(0.3125rem);
}

.nobody-chip {
  background: var(--tint-orange-8);
  border-radius: 9999px;
  color: var(--color-primary-500);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.625rem;
}

html.dark .nobody-chip {
  color: var(--color-accent-lift);
}

/* #123: the reminder stub, torn along a dashed line at the foot of the card in hand. It
   bleeds to the card's edges (the hand card body is padded 0.75rem; the card clips it). */
.reminder-stub {
  background: var(--tint-orange-8);
  border-top: 2px dashed var(--color-border);
  margin: 0.25rem -0.75rem -0.75rem;
  padding: 0.5rem 0.75rem 0.5625rem;
}

html.dark .reminder-stub {
  background: var(--color-surface-overlay);
  border-top-color: var(--color-line-strong);
}
</style>
