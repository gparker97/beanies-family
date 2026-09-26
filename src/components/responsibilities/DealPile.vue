<script setup lang="ts">
/**
 * Who Owns What (#109): the deal pile, card by card (round 7, mockup sections s1-s4). The
 * Deal view's default at every width: one card at a time, centered, with back / forward
 * arrows and the Kept and Skipped lists underneath.
 *
 *  - An **unsorted** card asks "Keep this card, or skip it?" (Keep and Skip look equally
 *    unselected). Keep reveals "Kept! Who owns it?"; a pick is ONE `deal` call (kept and
 *    dealt in one write, one undo), and only "Decide later" calls `keep`.
 *  - A **waiting** card goes straight to the faces. "Decide later" passes it for this visit.
 *  - A **held** or **skipped** card (reached by the arrows or the lists) shows what it is
 *    and offers a change (`DealPileBanner`): give it to someone else, skip instead, split
 *    it, bring back.
 *
 * `usePileCursor` owns which card is on screen: an id over a queue snapshot resolved
 * against the live store. `scope` only chooses that snapshot (`load`, once the deck has
 * loaded). The view comes from `pileView(status, picking)`; `picking` and `leaving` are the
 * only local UI flags, reset by one watcher (not while busy) and by `run()`'s `settle`.
 *
 * While an action is in flight the pile renders from a **snapshot** of the card taken when
 * the action started (`frozen`), not the live store: the write lands before the flight
 * does, and reading the live status would unmount the target face mid-flight (losing its
 * bounce), retitle the picker, or flash the held / skipped banner under the flying card.
 * The snapshot is released in `run()`'s `finally`, after the landing beat and `settle`.
 * After a first decision the pile advances to the next card still to decide; a revisit
 * change stays on the card to show its new banner. Every write goes through
 * `useDealActions` (one undo toast), and an Undo jumps the pile back to its card.
 *
 * The deal animation: the card flies into the chosen face (`useFlyTo`) and the face
 * bounces; a skip flies to the Skipped list's heading. Revisit changes don't fly. Reduced
 * motion: no flight, no bounce; the undo toast still confirms every action.
 *
 * Desktop shortcuts (`useKeyboardShortcuts`), unadvertised beyond `aria-keyshortcuts`:
 * K keep, S skip, 1-9 the Nth face, arrows step, U undo. Each calls the same function its
 * button does and returns false when that would do nothing, so the browser keeps the key
 * (an arrow at the end of the pile still scrolls). They act wherever focus is (the normal
 * way in leaves it on the Deal toggle), except while typing, inside a widget that owns the
 * arrows, or under a modal or popover. S flashes its button (`key-press`), which stays on
 * screen through the flight; K and the digits need no flash, because the faces opening and
 * the flight are the feedback, and the button or face they would flash is about to go.
 */
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { isAdultMember } from '@/composables/useMemberInfo';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { useKeyboardShortcuts, type ShortcutMap } from '@/composables/useKeyboardShortcuts';
import { flyTo } from '@/composables/useFlyTo';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import { groupShortcut, otherHumans, type ResolvedCard } from '@/utils/responsibilityDeck';
import type { UIStringKey } from '@/services/translation/uiStrings';
import InlineMemberPicker from '@/components/ui/InlineMemberPicker.vue';
import DeckActionButton from './DeckActionButton.vue';
import DeckCelebration from './DeckCelebration.vue';
import DealPileBanner from './DealPileBanner.vue';
import DealPileLists from './DealPileLists.vue';
import DealPileStage from './DealPileStage.vue';
import { useDealActions } from './useDealActions';
import { pileView, usePileCursor, type SettleMode } from './usePileCursor';

const props = withDefaults(
  defineProps<{
    /** Which cards the pile opens with: the first deal's unsorted cards, or the waiting ones. */
    scope: 'unsorted' | 'waiting';
    /** Open the pile at this card (the Overview's per-card Deal button). */
    startCardId?: string;
  }>(),
  { startCardId: undefined }
);
const emit = defineEmits<{
  split: [cardId: string];
  overview: [];
  'deal-waiting': [];
}>();

/** Every face tile in the picker carries this prefix + member id: the fly-to target. */
const PICK_TESTID_PREFIX = 'deal-pick-';
/** After a card lands, a beat to see the face bounce. */
const LANDING_BEAT_MS = 380;
const SURFACE = 'responsibilities';

const GROUP_QUESTION: Record<NonNullable<ResolvedCard['group']>, UIStringKey> = {
  car: 'whoOwnsWhat.pile.group.car',
  yard: 'whoOwnsWhat.pile.group.yard',
  pool: 'whoOwnsWhat.pile.group.pool',
  baby: 'whoOwnsWhat.pile.group.baby',
  pet: 'whoOwnsWhat.pile.group.pet',
  school: 'whoOwnsWhat.pile.group.school',
};

const { t } = useTranslation();
const store = useResponsibilityStore();
const familyStore = useFamilyStore();
const { categoryLabel } = useListCategoryLabel();
const { cardName, cardEmoji, partCaption } = useResponsibilityCardLabel();
const { pulse } = useAttentionPulse();
const actions = useDealActions();

const stageRef = useTemplateRef<{ cardEl: HTMLElement | null }>('stageRef');
const cardEl = computed(() => stageRef.value?.cardEl ?? null);
const skipBtn = useTemplateRef<{ $el: HTMLElement }>('skipBtn');
const listsRef = useTemplateRef<{ skippedHeadingEl: HTMLElement | null }>('listsRef');
const pickerRef = useTemplateRef<{
  memberTarget: (memberId: string) => { tile: HTMLElement; face: HTMLElement | null } | null;
}>('pickerRef');

// ── Telemetry ────────────────────────────────────────────────────────────────
const loggedOnce = new Set<string>();
function log(message: string, detail: string, level: 'info' | 'warn' = 'info'): void {
  logEvent({ level, surface: SURFACE, message, context: { detail } });
}
function logOnce(message: string, detail: string): void {
  if (loggedOnce.has(`${message}:${detail}`)) return;
  loggedOnce.add(`${message}:${detail}`);
  log(message, detail);
}

// ── The cursor ───────────────────────────────────────────────────────────────
const cursor = usePileCursor({
  cardById: (id) => store.cardById(id),
  order: () => store.resolved.map((c) => c.id),
});
const { currentId, position } = cursor;

watch(
  () => store.isLoaded,
  (loaded) => {
    if (!loaded || cursor.ready.value) return;
    const ids = store.resolved.filter((c) => c.status === props.scope).map((c) => c.id);
    cursor.load(ids, props.startCardId);
  },
  { immediate: true }
);

/** Double-tap guard: one action at a time, and the cursor can't move under a flight. */
const busy = ref(false);
type GroupShortcut = ReturnType<typeof groupShortcut>;
/**
 * The card as it was when the running action started, whether it was still to decide, and
 * its group-shortcut row. Set for the whole of `run()`; while set, the pile renders from it
 * (see the file header), so a group skip's own write can't unmount the row mid-flight.
 */
const frozen = shallowRef<{
  card: ResolvedCard;
  undecided: boolean;
  shortcut: GroupShortcut;
} | null>(null);
/** The card the pile renders: the in-flight snapshot, else the live card on screen. */
const card = computed(() => frozen.value?.card ?? cursor.current.value);
/** The faces are showing: after Keep, or for "Give it to someone else". */
const picking = ref(false);
/** Hidden after its flight so it can't flash back before the next card replaces it. */
const leaving = ref(false);
function resetFlags(): void {
  picking.value = false;
  leaving.value = false;
}
watch([currentId, () => cursor.current.value?.status], () => {
  if (!busy.value) resetFlags();
});
// A card deleted elsewhere while on screen: move on (a mid-flight one settles in `run`).
watch(cursor.current, (c) => {
  if (c || !currentId.value || busy.value) return;
  log('pile_card_missing', 'current');
  cursor.settle(currentId.value, 'advance');
});

const view = computed(() => (card.value ? pileView(card.value.status, picking.value) : null));
const bannerView = computed(() => {
  if (view.value === 'held' || view.value === 'skipped') return view.value;
  return card.value?.status === 'waiting' ? 'waiting' : null;
});
const undecided = computed(() =>
  frozen.value ? frozen.value.undecided : !!card.value && cursor.isUndecided(card.value.id)
);

const members = computed(() => familyStore.sortedHumans);
/** Who the faces offer, and what 1-9 index: everyone, or all but the holder when giving. */
const pickable = computed(() =>
  view.value === 'pick' && card.value?.status === 'held'
    ? otherHumans(members.value, card.value)
    : members.value
);

/** The part a pick deals: the first open one (the only one on an unsplit card). */
const part = computed(() => card.value?.parts.find((p) => !p.holderId) ?? card.value?.parts[0]);
const partLine = computed(() =>
  card.value && part.value ? partCaption(card.value, part.value) : ''
);
const positionLine = computed(() => {
  const pos = position.value;
  if (!pos) return '';
  const category = pos.category ? categoryLabel(pos.category) : t('lists.category.other');
  // A card visited from the lists sits outside the pile: its category, and no count.
  if (cursor.visiting.value) return category;
  return fillTemplate(t('whoOwnsWhat.pile.position'), { category, n: pos.n, total: pos.total });
});
const backToLabel = computed(() => {
  const next = cursor.nextToDecide.value ? store.cardById(cursor.nextToDecide.value) : undefined;
  return next ? fillTemplate(t('whoOwnsWhat.pile.backTo'), { card: cardName(next) }) : '';
});

// ── Progress ─────────────────────────────────────────────────────────────────
const remaining = cursor.remaining;
const total = cursor.total;
const doneCount = computed(() => total.value - remaining.value);
const toGo = computed(() =>
  fillTemplate(
    t(remaining.value === 1 ? 'whoOwnsWhat.pile.toGo.one' : 'whoOwnsWhat.pile.toGo.other'),
    { count: remaining.value }
  )
);

/** "No car? Skip all 3": live, except in flight, when the snapshot's row stands. */
const liveShortcut = (): GroupShortcut =>
  view.value === 'sort' && card.value?.status === 'unsorted'
    ? groupShortcut(store.resolved, card.value)
    : null;
const shortcut = computed(() => (frozen.value ? frozen.value.shortcut : liveShortcut()));

// ── Actions ──────────────────────────────────────────────────────────────────
/**
 * Runs one action on the card on screen. `fn` resolves false when the write was refused or
 * failed (the store has toasted), which keeps the faces open to try again. Afterwards the
 * cursor settles: on to the next card (`advance`) or stays to show the result (`stay`).
 */
async function run(fn: (c: ResolvedCard) => Promise<boolean>, after: SettleMode): Promise<void> {
  const c = card.value;
  if (busy.value || !c) return;
  busy.value = true;
  frozen.value = { card: c, undecided: cursor.isUndecided(c.id), shortcut: liveShortcut() };
  let ok = true;
  try {
    ok = await fn(c);
  } finally {
    busy.value = false;
    cursor.settle(c.id, after);
    frozen.value = null;
    if (ok || currentId.value !== c.id) resetFlags();
    else leaving.value = false;
  }
}
/** An Undo puts the pile back on the card it reversed. */
const undoTo = (c: ResolvedCard) => ({ onUndone: () => cursor.jumpTo(c.id) });

function landingBeat(): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, LANDING_BEAT_MS));
}

function pick(memberId: string): Promise<void> {
  const giving = card.value?.status === 'held';
  return run(
    async (c) => {
      const p = part.value;
      if (!p) return false;
      if (giving) {
        const res = await actions.deal(c.id, p.key, memberId, undoTo(c));
        if (res) log('pile_revisit_change', 'give');
        return !!res;
      }
      // One lookup for both beats: the card flies to the tile, then the avatar bounces.
      const target = pickerRef.value?.memberTarget(memberId) ?? null;
      leaving.value = true;
      const [, res] = await Promise.all([
        flyTo(cardEl.value, target?.tile ?? null),
        actions.deal(c.id, p.key, memberId, undoTo(c)),
      ]);
      if (!res) return false;
      // The avatar bounces (its tile's animation is taken by the entrance pop).
      pulse(target?.face, 'card-bounce');
      await landingBeat();
      return true;
    },
    giving ? 'stay' : 'advance'
  );
}

/** The picker's dismiss: Cancel when giving; else "Decide later" (keep it waiting, move on). */
function onPickerCancel(): Promise<void> {
  if (card.value?.status === 'held') {
    picking.value = false;
    return Promise.resolve();
  }
  return run(async (c) => {
    if (c.status === 'unsorted' && !(await actions.keep(c.id, undoTo(c)))) return false;
    cursor.pass(c.id);
    return true;
  }, 'advance');
}

function skipIds(ids: readonly string[]): Promise<void> {
  return run(async (c) => {
    if (!ids.length) return false;
    const target = listsRef.value?.skippedHeadingEl ?? null;
    leaving.value = true;
    const [, res] = await Promise.all([flyTo(cardEl.value, target), actions.skip(ids, undoTo(c))]);
    if (!res) return false;
    pulse(target, 'drop-flash');
    await landingBeat();
    return true;
  }, 'advance');
}

const canSkip = computed(
  () =>
    (view.value === 'sort' || view.value === 'pick') &&
    (card.value?.status === 'unsorted' || card.value?.status === 'waiting')
);
function skip(): Promise<void> {
  return canSkip.value && card.value ? skipIds([card.value.id]) : Promise.resolve();
}
function skipGroup(): Promise<void> {
  return shortcut.value ? skipIds(shortcut.value.unsortedIds) : Promise.resolve();
}
function keep(): void {
  if (view.value === 'sort' && !busy.value) picking.value = true;
}

// Revisit changes: no flight, the banner changes in place and the toast confirms.
function give(): void {
  if (view.value === 'held' && !busy.value) picking.value = true;
}
function skipInstead(): Promise<void> {
  return run(async (c) => {
    const res = await actions.skip([c.id], undoTo(c));
    if (res) log('pile_revisit_change', 'skip');
    return !!res;
  }, 'stay');
}
function bringBack(detail: 'bring_back' | 'bring_back_list' = 'bring_back'): Promise<void> {
  return run(async (c) => {
    const res = await actions.bringBack(c.id, undoTo(c));
    if (res) log('pile_revisit_change', detail);
    return !!res;
  }, 'stay');
}
/**
 * Bring back from the Skipped list: show that card, then the same revisit as its banner.
 * The move is part of the bring-back, not a list jump, so it logs only the revisit.
 */
function bringBackFromList(cardId: string): Promise<void> {
  if (busy.value) return Promise.resolve();
  if (currentId.value !== cardId) cursor.jumpTo(cardId);
  return bringBack('bring_back_list');
}

// ── Navigation ───────────────────────────────────────────────────────────────
function stepBy(dir: -1 | 1): void {
  if (busy.value || !cursor.canStep(dir)) return;
  cursor.step(dir);
  logOnce('pile_step', dir < 0 ? 'prev' : 'next');
}
function jumpTo(cardId: string): void {
  if (busy.value) return;
  cursor.jumpTo(cardId);
  log('pile_jump', 'list');
}
function backToNext(): void {
  const next = cursor.nextToDecide.value;
  if (next && !busy.value) cursor.jumpTo(next);
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
const KEY_CLASS: Record<string, string> = { k: 'keep', s: 'skip', u: 'undo' };
const keyClass = (key: string) => KEY_CLASS[key] ?? (key.startsWith('arrow') ? 'step' : 'pick');

// Each returns false when its button would do nothing, so the browser keeps the key.
function pickNth(n: number): false | Promise<void> {
  const m = pickable.value[n - 1];
  if (view.value !== 'pick' || busy.value || !m) return false;
  logOnce('pile_shortcut', 'pick');
  return pick(m.id);
}
function stepKey(dir: -1 | 1): boolean {
  if (busy.value || !cursor.canStep(dir)) return false;
  logOnce('pile_shortcut', 'step');
  stepBy(dir);
  return true;
}
const keyMap: ShortcutMap = {
  k: () => {
    if (view.value !== 'sort' || busy.value) return false;
    logOnce('pile_shortcut', 'keep');
    keep();
    return true;
  },
  s: () => {
    if (!canSkip.value || busy.value) return false;
    logOnce('pile_shortcut', 'skip');
    pulse(skipBtn.value?.$el, 'key-press');
    return skip();
  },
  arrowleft: () => stepKey(-1),
  arrowright: () => stepKey(1),
  u: () => {
    if (!actions.hasLiveUndo()) return false;
    logOnce('pile_shortcut', 'undo');
    return actions.undoLast();
  },
};
for (let n = 1; n <= 9; n++) keyMap[String(n)] = () => pickNth(n);
useKeyboardShortcuts(keyMap, {
  enabled: () => cursor.ready.value,
  tag: 'DealPile',
  onError: (key) => log('pile_shortcut_error', keyClass(key), 'warn'),
});

// ── Completion ───────────────────────────────────────────────────────────────
const finished = computed(() => cursor.ready.value && !currentId.value && !busy.value);
const kidsHolding = computed(
  () =>
    familyStore.sortedHumans.filter((m) => !isAdultMember(m) && store.myCards(m.id).length > 0)
      .length
);
const celebratePills = computed(() => {
  const out: string[] = [];
  const { splitCount, skipped } = store.stats;
  if (splitCount)
    out.push(
      fillTemplate(
        t(splitCount === 1 ? 'whoOwnsWhat.pile.pillSplit.one' : 'whoOwnsWhat.pile.pillSplit.other'),
        { count: splitCount }
      )
    );
  if (kidsHolding.value)
    out.push(
      fillTemplate(
        t(
          kidsHolding.value === 1
            ? 'whoOwnsWhat.pile.pillKids.one'
            : 'whoOwnsWhat.pile.pillKids.other'
        ),
        { count: kidsHolding.value }
      )
    );
  if (skipped) out.push(fillTemplate(t('whoOwnsWhat.pile.pillSkipped'), { count: skipped }));
  return out;
});
const nextCheckInLine = computed(() =>
  store.nextCheckIn
    ? fillTemplate(t('whoOwnsWhat.pile.nextCheckIn'), { date: formatNookDate(store.nextCheckIn) })
    : ''
);
const waitingLine = computed(() => {
  const n = store.stats.waiting;
  return fillTemplate(
    t(n === 1 ? 'whoOwnsWhat.pile.doneWaiting.one' : 'whoOwnsWhat.pile.doneWaiting.other'),
    { count: n }
  );
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col items-center gap-6" data-testid="deal-pile">
    <div class="flex w-full max-w-md flex-col items-center gap-4">
      <!-- Completion: every card has a holder, or the pile is done with some still waiting. -->
      <DeckCelebration
        v-if="finished && store.isFullyDealt && total > 0"
        :title="t('whoOwnsWhat.pile.celebrateTitle')"
        :body="fillTemplate(t('whoOwnsWhat.pile.celebrateBody'), { count: store.stats.deck })"
        :pills="celebratePills"
        :action-label="t('whoOwnsWhat.pile.seeOverview')"
        :note="nextCheckInLine"
        :image-alt="t('whoOwnsWhat.pile.imageAlt')"
        data-testid="deal-pile-celebrate"
        @action="emit('overview')"
      />

      <div
        v-else-if="finished"
        class="dark:bg-surface-raised dark:border-line flex w-full flex-col items-center gap-3 rounded-3xl border border-[var(--color-border)] bg-white px-5 py-6 text-center"
        data-testid="deal-pile-done"
      >
        <span class="text-4xl" aria-hidden="true">🃏</span>
        <h3 class="font-outfit dark:text-ink text-lg font-bold text-[var(--color-text)]">
          {{ total > 0 ? t('whoOwnsWhat.pile.doneTitle') : t('whoOwnsWhat.pile.empty') }}
        </h3>
        <p
          v-if="store.stats.waiting > 0"
          class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]"
        >
          {{ waitingLine }}
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <button
            v-if="store.stats.waiting > 0"
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 rounded-2xl bg-gradient-to-r px-4 py-2.5 text-sm font-bold text-white"
            data-testid="deal-pile-deal-waiting"
            @click="emit('deal-waiting')"
          >
            {{ t('whoOwnsWhat.pile.dealWaiting') }}
          </button>
          <button
            type="button"
            class="font-outfit text-secondary-500 dark:bg-surface-overlay dark:text-ink rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold"
            @click="emit('overview')"
          >
            {{ t('whoOwnsWhat.pile.seeOverview') }}
          </button>
        </div>
      </div>

      <template v-else-if="card">
        <!-- Progress -->
        <div class="w-full space-y-1.5" data-testid="deal-pile-progress">
          <p
            class="font-outfit dark:text-ink-faint text-xs font-semibold text-[var(--color-text-muted)]"
          >
            {{ toGo }}
          </p>
          <div
            class="progress-track h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            :aria-valuemin="0"
            :aria-valuemax="total"
            :aria-valuenow="doneCount"
            :aria-label="toGo"
          >
            <div
              class="from-primary-500 to-terracotta-400 h-full rounded-full bg-gradient-to-r transition-[width]"
              :style="{ width: `${total ? (doneCount / total) * 100 : 0}%` }"
            />
          </div>
        </div>

        <p
          class="font-outfit dark:text-ink-soft text-sm font-semibold text-[var(--color-text-muted)]"
          data-testid="deal-pile-position"
        >
          {{ positionLine }}
        </p>

        <DealPileStage
          ref="stageRef"
          :card="card"
          :leaving="leaving"
          :can-prev="!busy && cursor.canStep(-1)"
          :can-next="!busy && cursor.canStep(1)"
          @step="stepBy"
        />

        <!-- Keep or skip. Equal, unselected buttons; Keep first. -->
        <template v-if="view === 'sort'">
          <p
            class="font-outfit dark:text-ink text-lg font-bold text-[var(--color-text)]"
            data-testid="deal-pile-question"
          >
            {{ t('whoOwnsWhat.pile.question') }}
          </p>
          <div class="grid w-full max-w-sm grid-cols-2 gap-2.5">
            <DeckActionButton
              variant="choice"
              :disabled="busy"
              aria-keyshortcuts="K"
              data-testid="deal-pile-keep"
              @click="keep"
            >
              <span aria-hidden="true">✓</span> {{ t('whoOwnsWhat.pile.keep') }}
            </DeckActionButton>
            <DeckActionButton
              ref="skipBtn"
              variant="choice"
              :disabled="busy"
              aria-keyshortcuts="S"
              data-testid="deal-pile-skip"
              @click="skip"
            >
              <span aria-hidden="true">⏭️</span> {{ t('whoOwnsWhat.pile.skip') }}
            </DeckActionButton>
          </div>

          <!-- Group shortcut: "No car? Skip all 3 of these cards at once". -->
          <div
            v-if="shortcut"
            class="shortcut dark:border-line flex w-full items-center gap-2.5 rounded-2xl border border-[var(--tint-silk-30)] px-3 py-2.5 text-xs"
            data-testid="deal-pile-shortcut"
          >
            <span class="text-base" aria-hidden="true">{{ cardEmoji(card) }}</span>
            <span class="dark:text-ink-soft min-w-0 flex-1 text-[var(--color-text-muted)]">
              <b class="font-outfit dark:text-ink text-[var(--color-text)]">{{
                t(GROUP_QUESTION[shortcut.group])
              }}</b>
              {{
                fillTemplate(t('whoOwnsWhat.pile.groupBody'), {
                  count: shortcut.unsortedIds.length,
                })
              }}
            </span>
            <button
              type="button"
              class="font-outfit text-primary-500 dark:text-accent-lift shrink-0 font-bold whitespace-nowrap"
              :disabled="busy"
              data-testid="deal-pile-group-skip"
              @click="skipGroup"
            >
              {{
                fillTemplate(t('whoOwnsWhat.pile.groupAction'), {
                  count: shortcut.unsortedIds.length,
                })
              }}
            </button>
          </div>
        </template>

        <template v-else>
          <!-- A decided card: who has it (or waiting / skipped), and what can change. -->
          <DealPileBanner
            v-if="bannerView"
            :card="card"
            :view="bannerView"
            :can-give="otherHumans(members, card).length > 0"
            :disabled="busy"
            @give="give"
            @skip-instead="skipInstead"
            @split="emit('split', card.id)"
            @bring-back="bringBack()"
          />

          <!-- Who owns it? One tap deals (and, on a first deal, keeps) the card. -->
          <template v-if="view === 'pick'">
            <InlineMemberPicker
              ref="pickerRef"
              class="w-full"
              :members="pickable"
              :title="
                card.status === 'unsorted'
                  ? t('whoOwnsWhat.pile.kept')
                  : t('whoOwnsWhat.pile.whoOwns')
              "
              :subtitle="partLine || undefined"
              :back-label="
                card.status === 'held' ? t('action.cancel') : t('whoOwnsWhat.pile.decideLater')
              "
              :empty-message="t('whoOwnsWhat.pile.noMembers')"
              :tile-testid-prefix="PICK_TESTID_PREFIX"
              dismiss-style="close"
              number-shortcuts
              @pick="pick"
              @cancel="onPickerCancel"
            />
            <div v-if="card.status !== 'held'" class="flex flex-wrap justify-center gap-2">
              <DeckActionButton
                :disabled="busy"
                data-testid="deal-pile-split"
                @click="emit('split', card.id)"
              >
                <span aria-hidden="true">✂️</span> {{ t('whoOwnsWhat.pile.split') }}
              </DeckActionButton>
              <DeckActionButton
                ref="skipBtn"
                :disabled="busy"
                aria-keyshortcuts="S"
                data-testid="deal-pile-skip-pick"
                @click="skip"
              >
                <span aria-hidden="true">⏭️</span> {{ t('whoOwnsWhat.pile.skip') }}
              </DeckActionButton>
            </div>
          </template>
        </template>

        <button
          v-if="!undecided && backToLabel"
          type="button"
          class="font-outfit text-primary-500 dark:text-accent-lift text-sm font-semibold underline-offset-2 hover:underline"
          :disabled="busy"
          data-testid="deal-pile-back-to"
          @click="backToNext"
        >
          {{ backToLabel }} <span aria-hidden="true">›</span>
        </button>
      </template>
    </div>

    <DealPileLists
      v-if="cursor.ready.value"
      ref="listsRef"
      :current-id="currentId"
      :disabled="busy"
      @jump="jumpTo"
      @bring-back="bringBackFromList"
    />
  </div>
</template>

<style scoped>
.progress-track {
  background: var(--tint-slate-5);
}

html.dark .progress-track {
  background: var(--color-surface-overlay);
}

.shortcut {
  background: var(--tint-silk-10);
}

html.dark .shortcut {
  background: var(--color-surface-raised);
}
</style>
