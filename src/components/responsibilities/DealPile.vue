<script setup lang="ts">
/**
 * Who Owns What (#109): the deal pile (Requirements 9 and 10, mockup sections 2 and 9).
 * One card at a time on top of a pile. It serves two jobs:
 *
 *  - **First deal** (`scope: 'unsorted'`): every unsorted card in category order. "Keep this
 *    card, or skip it?" with Keep (primary, left) and Skip. Keep reveals "Who owns it?";
 *    a pick is ONE `deal` call (an unsorted card is kept and dealt in one write, one undo),
 *    and only "Decide later" calls `keep`.
 *  - **Phone deal view** (`scope: 'waiting'`): the kept cards with an open part, straight to
 *    "Who owns it?". "Decide later" just moves on (the card is already waiting).
 *
 * The queue is a snapshot of card ids taken once the deck has loaded; which card is on top
 * is derived from the LIVE store (the first queued card still in scope), so an undo from
 * the toast, or a change on another device, puts a card back on the pile without any
 * bookkeeping here. The one piece of session state is the log that draws who got what:
 * the emoji row under each face and the skipped tray. An undo removes its entry through
 * `useDealActions`' `onUndone`.
 *
 * The deal animation: the card flies into the chosen face (`useFlyTo`), the face bounces
 * (`card-bounce`), the emoji joins that face's row. The card on screen is pinned while an
 * action is in flight, so a store refresh mid-flight can't swap it under the animation.
 * Reduced motion: no flight, no bounce; the undo toast still confirms every action.
 */
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { isAdultMember } from '@/composables/useMemberInfo';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { flyTo } from '@/composables/useFlyTo';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import { groupByCategory, groupShortcut, type ResolvedCard } from '@/utils/responsibilityDeck';
import type { UIStringKey } from '@/services/translation/uiStrings';
import InlineMemberPicker from '@/components/ui/InlineMemberPicker.vue';
import DeckActionButton from './DeckActionButton.vue';
import DeckCelebration from './DeckCelebration.vue';
import { useDealActions } from './useDealActions';

const props = withDefaults(
  defineProps<{
    scope: 'unsorted' | 'waiting';
    /** Start the pile at this card (the Overview's per-card Deal button). */
    startCardId?: string;
    /** md+ only: offer the board instead of the pile. */
    showBoardLink?: boolean;
  }>(),
  { startCardId: undefined, showBoardLink: false }
);
const emit = defineEmits<{
  split: [cardId: string];
  overview: [];
  'deal-waiting': [];
  'use-board': [];
}>();

/** Every face tile in the picker carries this prefix + member id: the fly-to target. */
const PICK_TESTID_PREFIX = 'deal-pick-';
/** After a card lands, a beat to see the face bounce and the emoji join its row. */
const LANDING_BEAT_MS = 380;

const GROUP_QUESTION: Record<NonNullable<ResolvedCard['group']>, UIStringKey> = {
  car: 'whoOwnsWhat.pile.group.car',
  yard: 'whoOwnsWhat.pile.group.yard',
  pool: 'whoOwnsWhat.pile.group.pool',
  baby: 'whoOwnsWhat.pile.group.baby',
  pet: 'whoOwnsWhat.pile.group.pet',
  school: 'whoOwnsWhat.pile.group.school',
};
const FALLBACK_TINT = '#94A3B8';

const { t } = useTranslation();
const store = useResponsibilityStore();
const familyStore = useFamilyStore();
const { categoryLabel } = useListCategoryLabel();
const { cardName, cardDone, cardEmoji, partCaption } = useResponsibilityCardLabel();
const { pulse } = useAttentionPulse();
const actions = useDealActions();

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const cardEl = useTemplateRef<HTMLElement>('cardEl');
const trayEl = useTemplateRef<HTMLElement>('trayEl');

function inScope(card: ResolvedCard | undefined): card is ResolvedCard {
  if (!card) return false;
  return props.scope === 'unsorted' ? card.status === 'unsorted' : card.status === 'waiting';
}

// ── The queue (a snapshot) and the live top card ────────────────────────────
const queue = ref<string[]>([]);
const queueReady = ref(false);
/** Waiting-scope "Decide later": moved past this session without a write. */
const passed = ref(new Set<string>());

watch(
  () => store.isLoaded,
  (loaded) => {
    if (!loaded || queueReady.value) return;
    const ids = groupByCategory(store.resolved.filter(inScope)).flatMap((g) =>
      g.cards.map((c) => c.id)
    );
    const start = props.startCardId ? ids.indexOf(props.startCardId) : -1;
    if (start > 0) ids.unshift(...ids.splice(start, 1));
    queue.value = ids;
    queueReady.value = true;
  },
  { immediate: true }
);

const pending = computed(() =>
  queue.value.filter((id) => !passed.value.has(id) && inScope(store.cardById(id)))
);
const topId = computed(() => pending.value[0] ?? null);

/** The card on screen: follows the top card, but is pinned while an action is in flight. */
const busy = ref(false);
const shownId = ref<string | null>(null);
watch(
  topId,
  (id) => {
    if (!busy.value) shownId.value = id;
  },
  { immediate: true }
);
const card = computed(() => (shownId.value ? store.cardById(shownId.value) : undefined));

/** Keep/skip first on a first deal; straight to the faces for a waiting card. */
const stage = ref<'sort' | 'pick'>('sort');
/** Hidden after its flight so it can't flash back before the next card replaces it. */
const leaving = ref(false);
watch(
  shownId,
  () => {
    stage.value = props.scope === 'waiting' ? 'pick' : 'sort';
    leaving.value = false;
  },
  { immediate: true }
);

/** The part a pick deals: the first open one (the only one on an unsplit card). */
const part = computed(() => card.value?.parts.find((p) => !p.holderId) ?? card.value?.parts[0]);
const partLine = computed(() =>
  card.value && part.value ? partCaption(card.value, part.value) : ''
);
const tint = computed(
  () => (card.value && getListCategory(card.value.category)?.color) || FALLBACK_TINT
);

// ── Session log: who got what ────────────────────────────────────────────────
interface LogEntry {
  seq: number;
  kind: 'dealt' | 'kept' | 'skipped';
  cardIds: string[];
  memberId?: string;
  emojis: string[];
}
const log = ref<LogEntry[]>([]);
let seq = 0;

function record(entry: Omit<LogEntry, 'seq'>): number {
  const id = ++seq;
  log.value.push({ ...entry, seq: id });
  return id;
}
function forget(id: number): void {
  log.value = log.value.filter((e) => e.seq !== id);
}

/**
 * The session-log entry for ONE action, tied to its toast's Undo. The toast appears as soon
 * as the write resolves, but a dealt or skipped card is only recorded after its flight, so
 * an Undo can land first: it marks the action undone and `record` then writes nothing.
 */
function logEntryFor() {
  let id = 0;
  let undone = false;
  return {
    onUndone(): void {
      undone = true;
      if (id) forget(id);
    },
    /** Records the entry; false (nothing recorded) when the action was already undone. */
    record(entry: Omit<LogEntry, 'seq'>): boolean {
      if (undone) return false;
      id = record(entry);
      return true;
    },
  };
}

const members = computed(() => familyStore.sortedHumans);
function gotFor(memberId: string): string {
  return log.value
    .filter((e) => e.kind === 'dealt' && e.memberId === memberId)
    .flatMap((e) => e.emojis)
    .join('');
}
const trayEmojis = computed(() =>
  log.value
    .filter((e) => e.kind === 'skipped')
    .flatMap((e) => e.emojis)
    .join('')
);
const keptCount = computed(
  () => new Set(log.value.filter((e) => e.kind !== 'skipped').flatMap((e) => e.cardIds)).size
);
const skippedCount = computed(() =>
  log.value.filter((e) => e.kind === 'skipped').reduce((n, e) => n + e.cardIds.length, 0)
);

// ── Progress ─────────────────────────────────────────────────────────────────
const remaining = computed(() => pending.value.length);
const total = computed(() => queue.value.length);
const doneCount = computed(() => total.value - remaining.value);
const toGo = computed(() =>
  fillTemplate(
    t(remaining.value === 1 ? 'whoOwnsWhat.pile.toGo.one' : 'whoOwnsWhat.pile.toGo.other'),
    { count: remaining.value }
  )
);
const tally = computed(() =>
  fillTemplate(t('whoOwnsWhat.pile.tally'), {
    kept: keptCount.value,
    skipped: skippedCount.value,
  })
);

const shortcut = computed(() =>
  props.scope === 'unsorted' && card.value && stage.value === 'sort'
    ? groupShortcut(store.resolved, card.value)
    : null
);

// ── Actions ──────────────────────────────────────────────────────────────────
async function run(fn: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
  } finally {
    busy.value = false;
    // A split card with another open part stays on top: show it again.
    if (topId.value === shownId.value) leaving.value = false;
    shownId.value = topId.value;
  }
}

function landingBeat(): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, LANDING_BEAT_MS));
}

function faceEl(memberId: string): HTMLElement | null {
  return (
    rootEl.value?.querySelector<HTMLElement>(`[data-testid="${PICK_TESTID_PREFIX}${memberId}"]`) ??
    null
  );
}

function pick(memberId: string): Promise<void> {
  return run(async () => {
    const c = card.value;
    const p = part.value;
    if (!c || !p) return;
    const target = faceEl(memberId);
    leaving.value = true;
    const entry = logEntryFor();
    const [, res] = await Promise.all([
      flyTo(cardEl.value, target),
      actions.deal(c.id, p.key, memberId, { onUndone: entry.onUndone }),
    ]);
    if (!res) {
      leaving.value = false;
      return;
    }
    if (!entry.record({ kind: 'dealt', cardIds: [c.id], memberId, emojis: [cardEmoji(c)] })) return;
    pulse(target, 'card-bounce');
    await landingBeat();
  });
}

/** "Decide later": keep it waiting (first deal), or just move on (already waiting). */
function decideLater(): Promise<void> {
  return run(async () => {
    const c = card.value;
    if (!c) return;
    if (props.scope === 'waiting') {
      passed.value = new Set(passed.value).add(c.id);
      return;
    }
    const entry = logEntryFor();
    const res = await actions.keep(c.id, { onUndone: entry.onUndone });
    if (res) entry.record({ kind: 'kept', cardIds: [c.id], emojis: [] });
  });
}

function skipIds(ids: readonly string[]): Promise<void> {
  return run(async () => {
    const c = card.value;
    if (!c || !ids.length) return;
    leaving.value = true;
    const entry = logEntryFor();
    const [, res] = await Promise.all([
      flyTo(cardEl.value, trayEl.value),
      actions.skip(ids, { onUndone: entry.onUndone }),
    ]);
    if (!res) {
      leaving.value = false;
      return;
    }
    const emojis = ids.map((id) => {
      const s = store.cardById(id);
      return s ? cardEmoji(s) : '';
    });
    if (!entry.record({ kind: 'skipped', cardIds: [...ids], emojis })) return;
    pulse(trayEl.value, 'drop-flash');
    await landingBeat();
  });
}

function skip(): Promise<void> {
  return card.value ? skipIds([card.value.id]) : Promise.resolve();
}
function skipGroup(): Promise<void> {
  return shortcut.value ? skipIds(shortcut.value.unsortedIds) : Promise.resolve();
}

function keep(): void {
  stage.value = 'pick';
}

// ── Completion ───────────────────────────────────────────────────────────────
const finished = computed(() => queueReady.value && !topId.value && !busy.value);
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
  <div
    ref="rootEl"
    class="mx-auto flex w-full max-w-md flex-col items-center gap-4"
    data-testid="deal-pile"
  >
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
        <div
          class="font-outfit dark:text-ink-faint flex justify-between text-xs font-semibold text-[var(--color-text-muted)]"
        >
          <span>{{ toGo }}</span>
          <span>{{ tally }}</span>
        </div>
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

      <!-- The pile: two card backs, the live card on top. -->
      <div class="pile relative mt-1 shrink-0">
        <div class="card-back back-2" aria-hidden="true">
          <img src="/brand/beanies_logo_transparent_logo_only_192x192.png" alt="" />
        </div>
        <div class="card-back back-1" aria-hidden="true">
          <img src="/brand/beanies_logo_transparent_logo_only_192x192.png" alt="" />
        </div>
        <article
          ref="cardEl"
          :key="card.id"
          class="pile-card dark:bg-surface-raised dark:border-line-strong absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white"
          :class="{ 'is-leaving': leaving }"
          :style="{ '--cat': tint }"
          :data-testid="`deal-pile-card-${card.id}`"
        >
          <div class="slab relative grid place-items-center overflow-hidden">
            <span class="text-6xl leading-none" aria-hidden="true">{{ cardEmoji(card) }}</span>
            <span
              class="pointer-events-none absolute -right-1.5 -bottom-3.5 text-6xl leading-none opacity-[0.07]"
              aria-hidden="true"
              >{{ cardEmoji(card) }}</span
            >
          </div>
          <div class="flex flex-1 flex-col gap-1 p-3">
            <p
              class="font-outfit dark:text-ink text-lg leading-tight font-semibold text-[var(--color-text)]"
            >
              {{ cardName(card) }}
            </p>
            <p
              v-if="cardDone(card)"
              class="dark:text-ink-faint text-sm leading-snug text-[var(--color-text-muted)]"
            >
              {{ cardDone(card) }}
            </p>
            <span
              class="cat-chip font-outfit dark:text-ink-soft mt-auto inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--color-text)]"
            >
              <i class="h-2 w-2 rounded-full" :style="{ background: tint }" />{{
                categoryLabel(card.category)
              }}
            </span>
          </div>
        </article>
      </div>

      <!-- Stage 1 (first deal): keep or skip. Keep is primary and first. -->
      <template v-if="stage === 'sort'">
        <p
          class="font-outfit text-primary-500 dark:text-accent-lift text-lg font-bold"
          data-testid="deal-pile-question"
        >
          {{ t('whoOwnsWhat.pile.question') }}
        </p>
        <div class="grid w-full grid-cols-2 gap-2.5">
          <button
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 rounded-2xl bg-gradient-to-r px-3 py-3 text-sm font-bold text-white shadow-[0_4px_12px_rgb(241_93_34/20%)] disabled:opacity-60"
            :disabled="busy"
            data-testid="deal-pile-keep"
            @click="keep"
          >
            ✓ {{ t('whoOwnsWhat.pile.keep') }}
          </button>
          <button
            type="button"
            class="font-outfit dark:bg-surface-overlay dark:border-line dark:text-ink rounded-2xl border border-[var(--color-border)] bg-[#F3F5F7] px-3 py-3 text-sm font-bold text-[var(--color-text)] disabled:opacity-60"
            :disabled="busy"
            data-testid="deal-pile-skip"
            @click="skip"
          >
            <span aria-hidden="true">⏭️</span> {{ t('whoOwnsWhat.pile.skip') }}
          </button>
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
              fillTemplate(t('whoOwnsWhat.pile.groupBody'), { count: shortcut.unsortedIds.length })
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

      <!-- Stage 2: who owns it? One tap deals (and, on a first deal, keeps) the card. -->
      <template v-else>
        <InlineMemberPicker
          class="w-full"
          :members="members"
          :title="scope === 'unsorted' ? t('whoOwnsWhat.pile.kept') : t('whoOwnsWhat.pile.whoOwns')"
          :subtitle="partLine || undefined"
          :back-label="t('whoOwnsWhat.pile.decideLater')"
          :empty-message="t('whoOwnsWhat.pile.noMembers')"
          :tile-testid-prefix="PICK_TESTID_PREFIX"
          dismiss-style="close"
          @pick="pick"
          @cancel="decideLater"
        >
          <template #badge="{ member }">
            <span
              class="got min-h-[1.125rem] text-xs leading-none"
              :data-testid="`deal-pile-got-${member.id}`"
              >{{ gotFor(member.id) }}</span
            >
          </template>
        </InlineMemberPicker>
        <div class="flex flex-wrap justify-center gap-2">
          <DeckActionButton
            :disabled="busy"
            data-testid="deal-pile-split"
            @click="emit('split', card.id)"
          >
            <span aria-hidden="true">✂️</span> {{ t('whoOwnsWhat.pile.split') }}
          </DeckActionButton>
          <DeckActionButton :disabled="busy" data-testid="deal-pile-skip-pick" @click="skip">
            <span aria-hidden="true">⏭️</span> {{ t('whoOwnsWhat.pile.skip') }}
          </DeckActionButton>
        </div>
      </template>

      <!-- The skipped tray: its emoji row grows as cards drop in. -->
      <div
        ref="trayEl"
        class="tray dark:border-line-strong flex w-full items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[rgb(44_62_80/18%)] px-3 py-2"
        data-testid="deal-pile-tray"
      >
        <span
          class="font-outfit dark:text-ink-faint shrink-0 text-xs font-semibold text-[var(--color-text-muted)]"
          ><span aria-hidden="true">⏭️</span> {{ t('whoOwnsWhat.pile.skipped') }}</span
        >
        <span class="min-w-0 truncate text-sm" data-testid="deal-pile-tray-emojis">{{
          trayEmojis
        }}</span>
      </div>

      <button
        v-if="showBoardLink"
        type="button"
        class="font-outfit text-primary-500 dark:text-accent-lift text-xs font-semibold underline-offset-2 hover:underline"
        @click="emit('use-board')"
      >
        {{ t('whoOwnsWhat.pile.useBoard') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.pile {
  height: 17rem;
  width: 12.25rem;
}

.card-back {
  background: linear-gradient(155deg, #f15d22, #e67e22);
  border: 4px solid #fff;
  border-radius: 1rem;
  box-shadow: var(--card-shadow);
  display: grid;
  inset: 0;
  place-items: center;
  position: absolute;
}

html.dark .card-back {
  border-color: var(--color-surface-raised);
}

.card-back img {
  opacity: 0.9;
  width: 4.375rem;
}

.back-1 {
  transform: rotate(5deg) translate(0.625rem, 0.25rem);
}

.back-2 {
  transform: rotate(-4deg) translate(-0.5625rem, 0.375rem);
}

.pile-card {
  animation: pile-enter 280ms ease-out;
  box-shadow: var(--card-hover-shadow);
  transform: rotate(-2deg);
}

/* After its flight the card stays hidden until the next one replaces it. The flight's own
   keyframes set opacity, so this has no effect while it is in the air. */
.pile-card.is-leaving {
  opacity: 0;
}

@keyframes pile-enter {
  from {
    opacity: 0.5;
    transform: rotate(5deg) translate(0.625rem, 0.5rem);
  }

  to {
    opacity: 1;
    transform: rotate(-2deg);
  }
}

.slab {
  background: color-mix(in srgb, var(--cat) 12%, transparent);
  flex: 0 0 42%;
}

html.dark .slab {
  background: color-mix(in srgb, var(--cat) 18%, transparent);
}

.cat-chip {
  background: color-mix(in srgb, var(--cat) 12%, transparent);
}

html.dark .cat-chip {
  background: color-mix(in srgb, var(--cat) 22%, transparent);
}

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

.tray {
  background: transparent;
}

.got {
  display: block;
  letter-spacing: 0.05em;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
