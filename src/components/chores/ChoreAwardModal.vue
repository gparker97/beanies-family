<script setup lang="ts">
/**
 * Stars and rewards (#148): one special reward (on top of the weekly reward), added or edited. The app's right-hand drawer
 * (`BeanieFormModal variant="drawer"`, as the chore editors are) on every width; the desktop
 * mockup's inline edit is deliberately not built (plan, "Mockup deviation, deliberate").
 *
 *  - Special Reward: an emoji (`EmojiPicker`, `REWARD_EMOJI_OPTIONS`) and a name (`CHORE_TITLE_MAX`).
 *    The emoji follows the one rule (`rewardEmojiAfterRename`) against the name it was last
 *    settled against (as opened, or at a pick by hand): a rename that changes the name's
 *    suggestion picks the new one, even over a hand pick; otherwise the emoji stays. Opening a
 *    special reward never changes its emoji.
 *  - Who Is It For (only with two kids or more): All Kids (the default, stored as no
 *    `memberIds`, so a kid who joins later is included) or Pick Kids (`FamilyChipPicker`, at
 *    least one). The pricing table, the nudge and the estimate read only the kids it is for.
 *  - Kind: This Week (this week's stars only, starts again every week) or Saved Up (keeps counting
 *    across weeks). Saved Up only: One Time (the default; once reached it stays achieved) or
 *    Repeats (the count starts again the week after).
 *  - Price: two linked boxes, full weeks and stars. Type in either and the other shows what it
 *    means across the kids ("80 to 160" stars for 4 full weeks); the box last typed in is the
 *    price's unit. Full weeks is the default and the fair way. Every typed price goes through
 *    `parsePrice`, the one parser.
 *  - What that means for each child: per kid, their full week and the price in the other unit.
 *  - The fairness nudge (a stars price that asks one kid for much longer than another, from
 *    `fairPrice`) with a one-tap "Price it as N full weeks instead".
 *  - The real-time estimate (Saved Up): about how many weeks at the family's bar
 *    (`weeksEstimate`); This Week: whether it takes bonus stars.
 *
 * Every number comes from the pure rules (`utils/choreStars.ts`) over the kids' full weeks from
 * `starStore.weekFor`. Required fields go through `useFormValidation` (Save stays tappable and
 * rings what is missing). Saving is `starStore.saveAward`, deleting (behind the app's confirm)
 * `starStore.deleteAward`; the modal closes only on a non-null result, because a `null` has
 * already been toasted and logged by the store.
 *
 * MUST stay mounted while closed (`useFormModal` seeds on the open transition).
 *
 * Dark mode: the drawer's raised panel, body and inputs come from `BeanieFormModal`; the price boxes are `bg-white` /
 * `surface-raised` with `--color-border-strong` / `line-strong` edges (the active one Heritage
 * Orange / `accent-lift`); the per-child table is `--tint-slate-5` / `surface-overlay`; the
 * nudge `--tint-orange-8` (dark value in `style.css`); the estimate `--tint-silk-20` (likewise);
 * text `secondary-*` / `ink*`; the nudge's action `primary-700` / `accent-lift` (AA on the tint).
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import EmojiPicker from '@/components/ui/EmojiPicker.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { confirm } from '@/composables/useConfirm';
import { useFormModal } from '@/composables/useFormModal';
import { useFormValidation } from '@/composables/useFormValidation';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useStarStore } from '@/stores/starStore';
import { CHORE_TITLE_MAX } from '@/constants/choreBlocks';
import {
  AWARD_PRICE_MAX_STARS,
  AWARD_PRICE_MAX_WEEKS,
  DEFAULT_SPECIAL_REWARD_EMOJI,
  REWARD_EMOJI_OPTIONS,
  rewardEmojiAfterRename,
} from '@/constants/choreStars';
import {
  awardIsFor,
  awardPriceStars,
  fairPrice,
  parsePrice,
  weeksEstimate,
  type AwardDraft,
} from '@/utils/choreStars';
import { firstName } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreAward, FamilyMember } from '@/types/models';

type Unit = ChoreAward['unit'];
type Who = 'all' | 'some';

const props = defineProps<{
  open: boolean;
  /** The award to edit, or `null` to add one. */
  award: ChoreAward | null;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const starStore = useStarStore();
const { memberAvatarBindings } = useMemberAvatarBindings();

const title = ref('');
/** The name and emoji the emoji was last settled against: as opened, or at a pick by hand. */
const settled = ref({ name: '', emoji: DEFAULT_SPECIAL_REWARD_EMOJI });
/** The emoji shown and saved: the one rule over the settled name and the name as typed. */
const emoji = computed(() =>
  rewardEmojiAfterRename(
    settled.value.name,
    title.value,
    settled.value.emoji,
    DEFAULT_SPECIAL_REWARD_EMOJI
  )
);
const emojiOpen = ref(false);
/** Who it is for: every kid, or the kids in `chosen` (kept in family order on save). */
const who = ref<Who>('all');
const chosen = ref<string[]>([]);
const kind = ref<ChoreAward['kind']>('saved');
const repeats = ref(false);
const unit = ref<Unit>('weeks');
/** What was typed in each box; only the box of the price's `unit` is the price. */
const typed = ref<Record<Unit, string>>({ weeks: '', stars: '' });

function seedNew(): void {
  title.value = '';
  settled.value = { name: '', emoji: DEFAULT_SPECIAL_REWARD_EMOJI };
  emojiOpen.value = false;
  who.value = 'all';
  chosen.value = [];
  kind.value = 'saved';
  repeats.value = false;
  unit.value = 'weeks';
  typed.value = { weeks: '', stars: '' };
}

function seedEdit(award: ChoreAward): void {
  title.value = award.title;
  settled.value = { name: award.title, emoji: award.emoji || DEFAULT_SPECIAL_REWARD_EMOJI };
  emojiOpen.value = false;
  // Its kids, read through the one rule (an id that is no longer a kid is dropped here).
  const ids = (award.memberIds ?? []).length
    ? starStore.earners.filter((id) => awardIsFor(award, id))
    : [];
  who.value = (award.memberIds ?? []).length ? 'some' : 'all';
  chosen.value = ids;
  kind.value = award.kind;
  repeats.value = award.kind === 'saved' && award.repeats === true;
  unit.value = award.unit;
  typed.value = { weeks: '', stars: '' };
  typed.value[award.unit] = String(award.price);
}

const { isEditing, isSubmitting } = useFormModal(
  () => props.award,
  () => props.open,
  { onEdit: seedEdit, onNew: seedNew }
);

const emojiOptions = computed(() =>
  REWARD_EMOJI_OPTIONS.map((o) => ({ emoji: o.emoji, label: t(o.labelKey) }))
);
/** A pick by hand settles the emoji against the name as it stands. */
function pickEmoji(value: string): void {
  settled.value = { name: title.value, emoji: value };
  emojiOpen.value = false;
}

// ── Who it is for, and their full weeks ─────────────────────────────────────

/** Every kid who earns stars: the picker's chips. */
const allKids = computed<FamilyMember[]>(() => starStore.earnerMembers);
/** The picker is offered only when there is a choice to make. */
const canChoose = computed(() => allKids.value.length > 1);

const whoOptions = computed(() => [
  { value: 'all', label: t('choreStars.awardForm.who.all'), variant: 'orange' as const },
  { value: 'some', label: t('choreStars.awardForm.who.some'), variant: 'orange' as const },
]);
function setWho(value: string): void {
  if (value === 'all' || value === 'some') who.value = value;
}
function pickKids(value: string | string[]): void {
  chosen.value = Array.isArray(value) ? value : [];
}

/** The kids it is for as the draft stands, through the one rule (`awardIsFor`). */
const forDraft = computed(() =>
  who.value === 'some' && chosen.value.length
    ? { memberIds: chosen.value }
    : { memberIds: undefined }
);

/**
 * The kids it is for, with what a full week is worth for each of them today: the pricing table,
 * the fairness nudge and the estimate read only these (one kid chosen: nothing to compare).
 */
const kids = computed<{ member: FamilyMember; full: number }[]>(() =>
  allKids.value
    .filter((member) => awardIsFor(forDraft.value, member.id))
    .map((member) => ({
      member,
      full: starStore.weekFor(member.id)?.full ?? 0,
    }))
);
const withChores = computed(() => kids.value.filter((k) => k.full > 0));

// ── The price ───────────────────────────────────────────────────────────────

const parsed = computed(() => parsePrice(typed.value[unit.value], unit.value));
const price = computed<number | null>(() =>
  typeof parsed.value === 'number' ? parsed.value : null
);

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** "80" or "80 to 160": a set of numbers as the other box shows it. */
function spanText(values: number[]): string {
  if (!values.length) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi
    ? String(lo)
    : fillTemplate(t('choreStars.awardForm.span'), { low: lo, high: hi });
}

/** What the box NOT being typed in shows: the price in its unit, across the kids. */
const derived = computed<Record<Unit, string>>(() => {
  const p = price.value;
  if (p === null) return { weeks: '', stars: '' };
  if (unit.value === 'weeks') {
    return {
      weeks: '',
      stars: spanText(
        withChores.value.map((k) => awardPriceStars({ unit: 'weeks', price: p }, k.full))
      ),
    };
  }
  return { weeks: spanText(withChores.value.map((k) => oneDecimal(p / k.full))), stars: '' };
});

const boxText = (box: Unit) => (unit.value === box ? typed.value[box] : derived.value[box]);

function onBoxInput(box: Unit, event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  unit.value = box;
  typed.value = { ...typed.value, [box]: value };
}

/** Focusing the box that only shows a conversion selects it, so typing replaces it. */
function onBoxFocus(box: Unit, event: FocusEvent): void {
  if (unit.value !== box) (event.target as HTMLInputElement).select();
}

const priceError = computed(() => {
  const why = parsed.value;
  if (typeof why === 'number' || why === 'empty') return '';
  if (why === 'too-big') {
    return fillTemplate(t('choreStars.awardForm.priceTooBig'), {
      max: unit.value === 'stars' ? AWARD_PRICE_MAX_STARS : AWARD_PRICE_MAX_WEEKS,
    });
  }
  return t(
    unit.value === 'stars'
      ? 'choreStars.awardForm.priceInvalidStars'
      : 'choreStars.awardForm.priceInvalidWeeks'
  );
});

// ── What it means for each child ────────────────────────────────────────────

function plural(n: number, one: UIStringKey, other: UIStringKey): string {
  return fillTemplate(t(n === 1 ? one : other), { count: n });
}

const rows = computed(() =>
  kids.value.map(({ member, full }) => {
    const p = price.value;
    let value = '';
    if (full <= 0) value = t('choreStars.bar.nothingDue');
    else if (p !== null && unit.value === 'weeks') {
      value = plural(
        awardPriceStars({ unit: 'weeks', price: p }, full),
        'choreStars.awards.price.stars.one',
        'choreStars.awards.price.stars.other'
      );
    } else if (p !== null) {
      const weeks = p / full;
      const shown = oneDecimal(weeks);
      value =
        Math.abs(weeks - shown) < 1e-9
          ? plural(
              shown,
              'choreStars.awards.price.weeks.one',
              'choreStars.awards.price.weeks.other'
            )
          : fillTemplate(t('choreStars.awardForm.aboutWeeks'), { count: shown });
    }
    return {
      member,
      name: firstName(member.name),
      full:
        full > 0
          ? plural(full, 'choreStars.awardForm.fullWeek.one', 'choreStars.awardForm.fullWeek.other')
          : '',
      value,
    };
  })
);

// ── The nudge and the estimate ──────────────────────────────────────────────

const fair = computed(() => {
  if (unit.value !== 'stars' || price.value === null) return null;
  const fulls = Object.fromEntries(kids.value.map((k) => [k.member.id, k.full]));
  const f = fairPrice({ unit: 'stars', price: price.value }, fulls);
  if (!f.uneven || !f.slowest || !f.fastest || f.suggestedWeeks === null) return null;
  const nameOf = (id: string) => firstName(kids.value.find((k) => k.member.id === id)?.member.name);
  return {
    body: fillTemplate(t('choreStars.awardForm.nudge.body'), {
      slow: nameOf(f.slowest),
      fast: nameOf(f.fastest),
      ratio: f.ratio,
    }),
    action: plural(
      f.suggestedWeeks,
      'choreStars.awardForm.nudge.action.one',
      'choreStars.awardForm.nudge.action.other'
    ),
    weeks: f.suggestedWeeks,
  };
});

function takeSuggestion(weeks: number): void {
  unit.value = 'weeks';
  typed.value = { ...typed.value, weeks: String(weeks) };
}

/** The bar a usual week reaches: the weekly reward's, or a full week without one. */
const barPct = computed(() => (starStore.rewards.weeklyOn ? starStore.rewards.barPct : 100));

const estimate = computed(() => {
  const p = price.value;
  if (p === null || !withChores.value.length) return '';
  if (kind.value === 'week') {
    const overAWeek = unit.value === 'weeks' ? p > 1 : withChores.value.some((k) => p > k.full);
    return overAWeek ? t('choreStars.awardForm.bonusNeeded') : '';
  }
  const weeks =
    unit.value === 'weeks'
      ? [weeksEstimate(p, barPct.value)]
      : withChores.value.map((k) => weeksEstimate(p / k.full, barPct.value));
  const lo = Math.min(...weeks);
  const hi = Math.max(...weeks);
  if (lo !== hi) {
    return fillTemplate(t('choreStars.awardForm.estimate.range'), {
      pct: barPct.value,
      low: lo,
      high: hi,
    });
  }
  return fillTemplate(
    t(lo === 1 ? 'choreStars.awardForm.estimate.one' : 'choreStars.awardForm.estimate.other'),
    { pct: barPct.value, count: lo }
  );
});

// ── Kind ────────────────────────────────────────────────────────────────────

const kindOptions = computed(() => [
  { value: 'week', label: t('choreStars.awards.kind.week'), variant: 'orange' as const },
  { value: 'saved', label: t('choreStars.awards.kind.saved'), variant: 'orange' as const },
]);
function setKind(value: string): void {
  if (value === 'week' || value === 'saved') kind.value = value;
}
const repeatOptions = computed(() => [
  { value: 'once', label: t('choreStars.awards.oneTime'), variant: 'orange' as const },
  { value: 'repeats', label: t('choreStars.awards.repeats'), variant: 'orange' as const },
]);
function setRepeats(value: string): void {
  if (value === 'once' || value === 'repeats') repeats.value = value === 'repeats';
}

// ── Save and delete ─────────────────────────────────────────────────────────

const v = useFormValidation(
  'chore-award',
  () => ({
    title: () => title.value.trim().length > 0,
    price: () => price.value !== null,
    // "Pick Kids" needs at least one kid (a rule only while the chips are shown).
    ...(canChoose.value && who.value === 'some' ? { who: () => chosen.value.length > 0 } : {}),
  }),
  { open: () => props.open }
);

const modalTitle = computed(() =>
  t(isEditing.value ? 'choreStars.awardForm.editTitle' : 'choreStars.awardForm.newTitle')
);
const saveLabel = computed(() =>
  t(isEditing.value ? 'choreStars.awardForm.save' : 'choreStars.awardForm.add')
);

async function onSave(): Promise<void> {
  const actorId = familyStore.currentMemberId;
  if (isSubmitting.value || price.value === null || !actorId) return;
  const draft: AwardDraft & { id?: string } = {
    title: title.value.trim(),
    emoji: emoji.value,
    kind: kind.value,
    unit: unit.value,
    price: price.value,
    repeats: kind.value === 'saved' ? repeats.value : undefined,
    // Every kid picked is stored as every kid (the store does that), so a kid who joins later
    // is included.
    memberIds:
      who.value === 'some' && canChoose.value
        ? allKids.value.filter((m) => chosen.value.includes(m.id)).map((m) => m.id)
        : undefined,
  };
  if (props.award) draft.id = props.award.id;
  isSubmitting.value = true;
  try {
    // null: already toasted and logged by the store; the form stays as typed.
    const saved = await starStore.saveAward(draft, actorId);
    if (saved) emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function onDelete(): Promise<void> {
  const award = props.award;
  const actorId = familyStore.currentMemberId;
  if (!award || !actorId || isSubmitting.value) return;
  const ok = await confirm({
    title: 'choreStars.awardForm.delete.title',
    message: 'choreStars.awardForm.delete.message',
    detail: award.title,
    variant: 'danger',
  });
  if (!ok) return;
  isSubmitting.value = true;
  try {
    const removed = await starStore.deleteAward(award.id, actorId);
    if (removed) emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

const boxClass = (box: Unit) => [
  'flex min-w-0 flex-1 flex-col rounded-xl border-2 bg-white px-3 py-2 dark:bg-surface-raised focus-within:ring-2 focus-within:ring-sky-silk-100 dark:focus-within:ring-primary-700',
  unit.value === box
    ? 'border-primary-500 dark:border-accent-lift'
    : 'border-[var(--color-border-strong)] dark:border-line-strong',
];
const labelClass =
  'font-outfit text-secondary-500 dark:text-ink-soft text-xs font-semibold tracking-[0.08em] uppercase';
const hintClass = 'text-secondary-400 dark:text-ink-faint text-xs leading-snug';
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="modalTitle"
    :icon="emoji"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="saveLabel"
    :save-ready="v.canSave.value"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    save-testid="chore-award-save"
    @close="emit('close')"
    @save="v.attemptSave(onSave)"
    @delete="onDelete"
  >
    <div class="space-y-5" data-testid="chore-award-modal">
      <FormFieldGroup :label="t('choreStars.awardForm.award')" v-bind="v.bind('title')">
        <div class="flex items-start gap-2">
          <button
            type="button"
            class="dark:bg-surface-overlay focus-visible:ring-sky-silk-300 grid h-11 w-11 flex-none place-items-center rounded-[14px] bg-[var(--tint-orange-8)] text-xl focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="t('choreStars.weekly.emojiLabel')"
            :aria-expanded="emojiOpen ? 'true' : 'false'"
            data-testid="chore-award-emoji"
            @click="emojiOpen = !emojiOpen"
          >
            <span aria-hidden="true">{{ emoji }}</span>
          </button>
          <div class="min-w-0 flex-1">
            <BaseInput
              v-model="title"
              :maxlength="CHORE_TITLE_MAX"
              :placeholder="t('choreStars.awardForm.namePlaceholder')"
              :aria-label="t('choreStars.awardForm.nameLabel')"
              data-testid="chore-award-title"
            />
          </div>
        </div>
        <div v-if="emojiOpen" class="mt-2" data-testid="chore-award-emoji-picker">
          <EmojiPicker
            :model-value="emoji"
            :options="emojiOptions"
            @update:model-value="pickEmoji"
          />
        </div>
      </FormFieldGroup>

      <FormFieldGroup
        v-if="canChoose"
        :label="t('choreStars.awardForm.who')"
        v-bind="v.bind('who')"
        :error-message="v.showError('who') ? t('choreStars.awardForm.whoRequired') : undefined"
      >
        <div class="space-y-2">
          <div data-testid="chore-award-who">
            <TogglePillGroup
              :model-value="who"
              :options="whoOptions"
              :aria-label="t('choreStars.awardForm.who')"
              @update:model-value="setWho"
            />
          </div>
          <div v-if="who === 'some'" data-testid="chore-award-who-kids">
            <FamilyChipPicker
              :model-value="chosen"
              mode="multi"
              :members="allKids"
              @update:model-value="pickKids"
            />
          </div>
          <p :class="hintClass" data-testid="chore-award-who-hint">
            {{
              t(
                who === 'some'
                  ? 'choreStars.awardForm.whoHint.some'
                  : 'choreStars.awardForm.whoHint.all'
              )
            }}
          </p>
        </div>
      </FormFieldGroup>

      <FormFieldGroup :label="t('choreStars.awardForm.kind')">
        <div class="space-y-2">
          <div data-testid="chore-award-kind">
            <TogglePillGroup
              :model-value="kind"
              :options="kindOptions"
              :aria-label="t('choreStars.awardForm.kind')"
              @update:model-value="setKind"
            />
          </div>
          <p :class="hintClass" data-testid="chore-award-kind-hint">
            {{
              t(
                kind === 'week'
                  ? 'choreStars.awardForm.kindHint.week'
                  : 'choreStars.awardForm.kindHint.saved'
              )
            }}
          </p>
          <template v-if="kind === 'saved'">
            <div data-testid="chore-award-repeats">
              <TogglePillGroup
                :model-value="repeats ? 'repeats' : 'once'"
                :options="repeatOptions"
                :aria-label="t('choreStars.awardForm.repeatsLabel')"
                @update:model-value="setRepeats"
              />
            </div>
            <p :class="hintClass" data-testid="chore-award-repeats-hint">
              {{
                t(
                  repeats
                    ? 'choreStars.awardForm.repeatsHint.repeats'
                    : 'choreStars.awardForm.repeatsHint.once'
                )
              }}
            </p>
          </template>
        </div>
      </FormFieldGroup>

      <FormFieldGroup
        :label="t('choreStars.awardForm.price')"
        v-bind="v.bind('price')"
        :error="v.showError('price') || !!priceError"
        :error-message="priceError || (v.showError('price') ? t('validation.required') : undefined)"
      >
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <label
              :class="boxClass('weeks')"
              data-testid="chore-award-box-weeks"
              :data-active="unit === 'weeks' ? 'true' : undefined"
            >
              <input
                type="text"
                inputmode="decimal"
                autocomplete="off"
                class="font-outfit text-secondary-500 dark:text-ink w-full border-0 bg-transparent p-0 text-lg font-bold focus:outline-none"
                :value="boxText('weeks')"
                :aria-label="t('choreStars.awardForm.weeksLabel')"
                data-testid="chore-award-weeks"
                @input="onBoxInput('weeks', $event)"
                @focus="onBoxFocus('weeks', $event)"
              />
              <small class="text-secondary-400 dark:text-ink-faint text-xs">{{
                t('choreStars.awardForm.weeksUnit')
              }}</small>
            </label>
            <span
              class="font-outfit text-secondary-400 dark:text-ink-soft font-bold"
              aria-hidden="true"
              >=</span
            >
            <label
              :class="boxClass('stars')"
              data-testid="chore-award-box-stars"
              :data-active="unit === 'stars' ? 'true' : undefined"
            >
              <input
                type="text"
                inputmode="numeric"
                autocomplete="off"
                class="font-outfit text-secondary-500 dark:text-ink w-full border-0 bg-transparent p-0 text-lg font-bold focus:outline-none"
                :value="boxText('stars')"
                :aria-label="t('choreStars.awardForm.starsLabel')"
                data-testid="chore-award-stars"
                @input="onBoxInput('stars', $event)"
                @focus="onBoxFocus('stars', $event)"
              />
              <small class="text-secondary-400 dark:text-ink-faint text-xs">{{
                t('choreStars.awardForm.starsUnit')
              }}</small>
            </label>
          </div>
          <p :class="hintClass">{{ t('choreStars.awardForm.priceHint') }}</p>
        </div>
      </FormFieldGroup>

      <div v-if="kids.length" class="space-y-2">
        <span :class="labelClass">{{ t('choreStars.awardForm.perChild') }}</span>
        <ul
          class="dark:bg-surface-overlay flex flex-col gap-2 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5"
          data-testid="chore-award-children"
        >
          <li
            v-for="row in rows"
            :key="row.member.id"
            class="flex items-center gap-2.5 text-sm"
            data-testid="chore-award-child"
            :data-member-id="row.member.id"
          >
            <BeanieAvatar v-bind="memberAvatarBindings(row.member)" size="xs" />
            <span class="min-w-0 flex-1">
              <span class="text-secondary-500 dark:text-ink">{{ row.name }}</span>
              <small
                v-if="row.full"
                class="text-secondary-400 dark:text-ink-faint ml-1.5 text-xs"
                >{{ row.full }}</small
              >
            </span>
            <b
              class="font-outfit text-secondary-500 dark:text-ink text-right font-bold whitespace-nowrap"
              data-testid="chore-award-child-value"
              >{{ row.value }}</b
            >
          </li>
        </ul>
      </div>

      <div
        v-if="fair"
        class="flex items-start gap-2.5 rounded-2xl bg-[var(--tint-orange-8)] px-3.5 py-3 text-sm leading-snug"
        data-testid="chore-award-nudge"
      >
        <span class="flex-none" aria-hidden="true">⚖️</span>
        <p class="text-secondary-500 dark:text-ink min-w-0">
          <b class="font-outfit font-bold">{{ t('choreStars.awardForm.nudge.title') }}</b>
          {{ fair.body }}
          <button
            type="button"
            class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 rounded font-semibold underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-award-nudge-action"
            @click="takeSuggestion(fair.weeks)"
          >
            {{ fair.action }}
          </button>
        </p>
      </div>

      <div
        v-if="estimate"
        class="flex items-start gap-2.5 rounded-2xl bg-[var(--tint-silk-20)] px-3.5 py-3 text-sm leading-snug"
        data-testid="chore-award-estimate"
      >
        <span class="flex-none" aria-hidden="true">🧭</span>
        <p class="text-secondary-500 dark:text-ink min-w-0">{{ estimate }}</p>
      </div>
    </div>
  </BeanieFormModal>
</template>
