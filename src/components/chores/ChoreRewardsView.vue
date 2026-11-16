<script setup lang="ts">
/**
 * Stars and rewards (#148): the Choreboard's "Stars and Rewards" view, drawn by
 * `ChoreboardPage` for a grown-up only (the view switch is grown-ups-only; every write here is
 * also refused for a non-adult by the star store).
 *
 * Off (`Settings.choreRewards` absent or `on: false`): the turn-on panel and nothing else. On,
 * every setting optional (plan, requirement 12, with greg's 2026-11-16 changes: no take-back
 * setting, taking stars away is always open to a grown-up):
 *  - the on / off switch at the top;
 *  - the weekly reward: on / off, its name and emoji (a rename that changes the name's
 *    suggestion picks the new one as it is typed, even over one picked by hand;
 *    `rewardEmojiAfterRename`), and the bar (a share of a full week's stars, 50 to 100 in
 *    steps of 5) with each child's "N of M stars";
 *  - Extra Special Rewards (on top of the weekly reward): the list (with "For Max" when one is
 *    not for every kid); Add Special Reward asks the page for its ONE drawer (`open-award`,
 *    `ChoreAwardModal`) empty, a row asks for it on that special reward to edit or delete;
 *  - What Chores Are Worth: per child, a stepper per chore (1 to 5), the full-week total and a
 *    preview of that child's path strip, so a change shows at once.
 *
 * MVO: every number comes from `starStore` getters; every control is one intent to one store
 * action (`setRewards`, or `choreStore.updateChore` with `via: 'rewards'` for a chore's value);
 * the page's award drawer saves and deletes through `starStore.saveAward` / `deleteAward`.
 * Each action resolves `null` after it has already toasted and logged, so this view never
 * toasts. Text is saved on blur or Enter (never per keystroke: a string costs one op per
 * character in the family file), the bar after a short pause.
 *
 * Layout: one column on a phone (on, weekly reward, awards, chore values); from 1280px three
 * columns (on and the weekly reward; awards; chore values), as the mockup.
 *
 * Dark mode: cards `bg-white` / `surface-raised` with `line` edges; tiles inside a card
 * `--tint-slate-5` / `surface-overlay`; text `secondary-*` / `ink*`; chips' selected edge
 * Heritage Orange / `accent-lift`. No scoped rule paints anything.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import EmojiPicker from '@/components/ui/EmojiPicker.vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import ToggleRow from '@/components/ui/ToggleRow.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import StarCount from '@/components/chores/StarCount.vue';
import StarPathStrip from '@/components/chores/StarPathStrip.vue';
import StarsTurnOnPanel from '@/components/chores/StarsTurnOnPanel.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { useChoreStore } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useStarStore, type ChoreRewardsPatch } from '@/stores/starStore';
import { CHORE_TITLE_MAX, choreEmoji } from '@/constants/choreBlocks';
import {
  CHORE_STARS_MAX,
  CHORE_STARS_MIN,
  DEFAULT_REWARD_EMOJI,
  REWARD_EMOJI_OPTIONS,
  STAR_BAR_MAX,
  STAR_BAR_MIN,
  STAR_BAR_STEP,
  rewardEmojiAfterRename,
  suggestRewardEmoji,
} from '@/constants/choreStars';
import { firstName, formatNameList } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { awardKids, starsOf } from '@/utils/choreStars';
import type { ChoreAward, FamilyMember } from '@/types/models';

/** How long the bar waits after the last change before it saves. */
const BAR_SAVE_MS = 500;

const emit = defineEmits<{
  /** Add Special Reward (`null`) or a special reward's row: the page's ONE drawer opens. */
  'open-award': [award: ChoreAward | null];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const choreStore = useChoreStore();
const starStore = useStarStore();
const settingsStore = useSettingsStore();
const { memberAvatarBindings } = useMemberAvatarBindings();

const actorId = computed(() => familyStore.currentMemberId);
const rewards = computed(() => starStore.rewards);

/** One intent: a patch to the family's stars and rewards settings. */
function save(patch: ChoreRewardsPatch): void {
  const actor = actorId.value;
  if (actor) void starStore.setRewards(patch, actor);
}

// ── On / off and the weekly reward ──────────────────────────────────────────

function setOn(on: boolean): void {
  save({ on });
}

function setWeeklyOn(on: boolean): void {
  // The emoji shown is the emoji stored: a reward turned on with none gets its name's (or the
  // default).
  save(
    on && !rewards.value.emoji
      ? {
          weeklyOn: true,
          emoji: suggestRewardEmoji(rewards.value.title ?? '') ?? DEFAULT_REWARD_EMOJI,
        }
      : { weeklyOn: on }
  );
}

/** The name as typed; follows the store while the field is not being edited. */
const titleDraft = ref(rewards.value.title ?? '');
const titleEditing = ref(false);
watch(
  () => rewards.value.title,
  (title) => {
    if (!titleEditing.value) titleDraft.value = title ?? '';
  }
);

/**
 * The emoji a name gives, by the one rule (`rewardEmojiAfterRename`) against the stored name
 * and emoji (a pick by hand is saved at once, so the stored name is always the one the emoji was
 * settled against): it changes only when the name's suggestion changes. What the typed name
 * shows is exactly what its commit saves.
 */
function emojiForName(name: string): string {
  return rewardEmojiAfterRename(
    rewards.value.title,
    name,
    rewards.value.emoji,
    DEFAULT_REWARD_EMOJI
  );
}

/** The name and its emoji, saved together in one patch (blur or Enter), only what changed. */
function commitTitle(): void {
  titleEditing.value = false;
  const next = titleDraft.value.trim();
  if (next === (rewards.value.title ?? '')) return;
  const emoji = emojiForName(next);
  save(emoji === rewards.value.emoji ? { title: next } : { title: next, emoji });
}

const emojiOpen = ref(false);
const emojiOptions = computed(() =>
  REWARD_EMOJI_OPTIONS.map((o) => ({ emoji: o.emoji, label: t(o.labelKey) }))
);
/** The emoji shown, as the name is typed. */
const rewardEmoji = computed(() => emojiForName(titleDraft.value.trim()));

/** A pick by hand is saved at once and holds until a rename changes the name's suggestion. */
function pickEmoji(emoji: string): void {
  emojiOpen.value = false;
  if (emoji !== rewards.value.emoji) save({ emoji });
}

/** The bar as shown: the stepper's value, saved after a short pause. */
const barDraft = ref<number>(rewards.value.barPct);
let barTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => rewards.value.barPct,
  (pct) => {
    if (barTimer === undefined) barDraft.value = pct;
  }
);

function onBar(value: number | undefined): void {
  if (value === undefined) return;
  barDraft.value = value;
  if (barTimer !== undefined) clearTimeout(barTimer);
  barTimer = setTimeout(flushBar, BAR_SAVE_MS);
}

function flushBar(): void {
  if (barTimer !== undefined) clearTimeout(barTimer);
  barTimer = undefined;
  if (barDraft.value !== rewards.value.barPct) save({ barPct: barDraft.value });
}

// A change made just before switching view or leaving still saves.
onBeforeUnmount(() => {
  if (barTimer !== undefined) flushBar();
});

const freshKey = computed(() =>
  settingsStore.weekStartDay === 0
    ? 'choreStars.weekly.freshSunday'
    : 'choreStars.weekly.freshMonday'
);

// ── The kids ────────────────────────────────────────────────────────────────

/** The children who earn stars, in family order. */
const kids = computed<FamilyMember[]>(() => starStore.earnerMembers);

/** "32 of 40 stars" for a child this week: the bar and a full week, from the star store. */
function barLine(memberId: string): string {
  const week = starStore.weekFor(memberId);
  if (!week || week.full <= 0) return t('choreStars.bar.nothingDue');
  return fillTemplate(
    t(week.full === 1 ? 'choreStars.bar.child.one' : 'choreStars.bar.child.other'),
    { bar: week.bar, full: week.full }
  );
}

// ── Extra Special Rewards ───────────────────────────────────────────────────

const awards = computed(() => starStore.sortedAwards);

function awardLine(award: ChoreAward): string {
  const weeks = award.unit === 'weeks';
  const priceKey = weeks
    ? award.price === 1
      ? 'choreStars.awards.price.weeks.one'
      : 'choreStars.awards.price.weeks.other'
    : award.price === 1
      ? 'choreStars.awards.price.stars.one'
      : 'choreStars.awards.price.stars.other';
  const parts = [fillTemplate(t(priceKey), { count: award.price })];
  if (award.kind === 'saved') {
    parts.push(t(award.repeats ? 'choreStars.awards.repeats' : 'choreStars.awards.oneTime'));
  }
  const who = forKidsLine(award);
  if (who) parts.push(who);
  return parts.join(' · ');
}

/** "For Max & Pip" when a special reward is not for every kid, else ''. */
function forKidsLine(award: ChoreAward): string {
  const ids = awardKids(award, starStore.earners);
  if (ids === null) return '';
  const names = ids.map((id) => firstName(kids.value.find((k) => k.id === id)?.name));
  return names.length
    ? fillTemplate(t('choreStars.awards.forKids'), { names: formatNameList(names) })
    : t('choreStars.awards.forNobody');
}

/** The special reward drawer is the page's (ONE): ask for it, empty or on that reward. */
function openAwardForm(award: ChoreAward | null): void {
  emit('open-award', award);
}

// ── What Chores Are Worth ───────────────────────────────────────────────────

const pickedKidId = ref<string | null>(null);
const pickedKid = computed<FamilyMember | null>(
  () => kids.value.find((k) => k.id === pickedKidId.value) ?? kids.value[0] ?? null
);

/** The picked child's chores, in the board's order. A shared chore has one value for both. */
const kidChores = computed(() => {
  const kid = pickedKid.value;
  if (!kid) return [];
  return choreStore.sortedChores.filter((c) => (c.assigneeIds ?? []).includes(kid.id));
});

const kidWeek = computed(() => (pickedKid.value ? starStore.weekFor(pickedKid.value.id) : null));
const kidStrip = computed(() => (pickedKid.value ? starStore.stripFor(pickedKid.value.id) : null));

function setChoreStars(choreId: string, value: number | undefined): void {
  const actor = actorId.value;
  const chore = choreStore.choreById(choreId);
  if (!actor || !chore || value === undefined || value === starsOf(chore)) return;
  void choreStore.updateChore(choreId, { stars: value }, actor, { via: 'rewards' });
}

const cardClass =
  'dark:bg-surface-raised dark:border-line flex flex-col gap-3 rounded-3xl bg-white p-4 shadow-[var(--card-shadow)] dark:border';
const sectionTitleClass = 'font-outfit text-secondary-500 dark:text-ink text-base font-bold';
const hintClass = 'text-secondary-400 dark:text-ink-faint text-xs';
</script>

<template>
  <StarsTurnOnPanel v-if="!rewards.on" />

  <div v-else class="rewards-layout flex flex-col gap-4" data-testid="chore-rewards-view">
    <!-- Column A (from 1280px): on, weekly reward. -->
    <div class="rewards-col contents">
      <section :class="cardClass" class="order-1" data-testid="chore-rewards-on">
        <ToggleRow
          :model-value="rewards.on"
          :title="t('choreStars.setup.on')"
          :hint="t('choreStars.setup.onHint')"
          testid="chore-rewards-on-switch"
          @update:model-value="setOn"
        />
      </section>

      <section :class="cardClass" class="order-2" data-testid="chore-rewards-weekly">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <h2 :class="sectionTitleClass">{{ t('choreStars.weekly.title') }}</h2>
            <p :class="hintClass">{{ t('choreStars.weekly.hint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="rewards.weeklyOn"
            :aria-label="t('choreStars.weekly.title')"
            data-testid="chore-rewards-weekly-switch"
            @update:model-value="setWeeklyOn"
          />
        </div>

        <template v-if="rewards.weeklyOn">
          <div class="flex items-start gap-2">
            <button
              type="button"
              class="dark:bg-surface-overlay focus-visible:ring-sky-silk-300 grid h-11 w-11 flex-none place-items-center rounded-[14px] bg-[var(--tint-orange-8)] text-xl focus-visible:ring-2 focus-visible:outline-none"
              :aria-label="t('choreStars.weekly.emojiLabel')"
              :aria-expanded="emojiOpen ? 'true' : 'false'"
              data-testid="chore-rewards-emoji"
              @click="emojiOpen = !emojiOpen"
            >
              <span aria-hidden="true">{{ rewardEmoji }}</span>
            </button>
            <div class="min-w-0 flex-1">
              <BaseInput
                v-model="titleDraft"
                :placeholder="t('choreStars.weekly.namePlaceholder')"
                :aria-label="t('choreStars.weekly.nameLabel')"
                :maxlength="CHORE_TITLE_MAX"
                data-testid="chore-rewards-title"
                @focus="titleEditing = true"
                @blur="commitTitle"
                @keyup.enter="($event.target as HTMLInputElement).blur()"
              />
            </div>
          </div>
          <div v-if="emojiOpen" data-testid="chore-rewards-emoji-picker">
            <EmojiPicker
              :model-value="rewardEmoji"
              :options="emojiOptions"
              @update:model-value="pickEmoji"
            />
          </div>

          <div class="mt-1 flex flex-col gap-2">
            <span
              class="font-outfit text-secondary-500 dark:text-ink-soft text-xs font-semibold tracking-[0.08em] uppercase"
              >{{ t('choreStars.bar.title') }}</span
            >
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span class="flex items-baseline gap-2">
                <span
                  class="font-outfit text-secondary-500 dark:text-ink text-2xl font-extrabold"
                  data-testid="chore-rewards-bar-value"
                  >{{ fillTemplate(t('choreStars.bar.pct'), { pct: barDraft }) }}</span
                >
                <span class="text-secondary-400 dark:text-ink-soft text-sm">{{
                  t('choreStars.bar.ofFull')
                }}</span>
              </span>
              <div class="ml-auto">
                <NumberStepper
                  :model-value="barDraft"
                  :min="STAR_BAR_MIN"
                  :max="STAR_BAR_MAX"
                  :step="STAR_BAR_STEP"
                  :label="t('choreStars.bar.label')"
                  data-testid="chore-rewards-bar"
                  @update:model-value="onBar"
                />
              </div>
            </div>
          </div>

          <ul v-if="kids.length" class="flex flex-col gap-2" data-testid="chore-rewards-bar-kids">
            <li v-for="kid in kids" :key="kid.id" class="flex items-center gap-2.5 text-sm">
              <BeanieAvatar v-bind="memberAvatarBindings(kid)" size="xs" />
              <span class="text-secondary-500 dark:text-ink min-w-0 flex-1 truncate">{{
                firstName(kid.name)
              }}</span>
              <b
                class="font-outfit text-secondary-500 dark:text-ink font-bold whitespace-nowrap"
                data-testid="chore-rewards-bar-kid"
                :data-member-id="kid.id"
                >{{ barLine(kid.id) }}</b
              >
            </li>
          </ul>
          <p :class="hintClass">{{ t(freshKey) }}</p>
        </template>
      </section>
    </div>

    <!-- Column B: Extra Special Rewards. -->
    <div class="rewards-col contents">
      <section :class="cardClass" class="order-3" data-testid="chore-rewards-awards">
        <!-- The button never breaks inside: it goes under the title, whole, before it would. -->
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 :class="sectionTitleClass">{{ t('choreStars.awards.title') }}</h2>
          <button
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 focus-visible:ring-sky-silk-300 inline-flex items-center gap-1 rounded-2xl bg-gradient-to-r px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-rewards-add-award"
            @click="openAwardForm(null)"
          >
            <span aria-hidden="true">+</span> {{ t('choreStars.awards.add') }}
          </button>
        </div>
        <p v-if="!awards.length" :class="hintClass" data-testid="chore-rewards-awards-empty">
          {{ t('choreStars.awards.empty') }}
        </p>
        <ul v-else class="flex flex-col gap-2">
          <li v-for="award in awards" :key="award.id">
            <button
              type="button"
              class="dark:bg-surface-overlay dark:hover:bg-surface-hover focus-visible:ring-sky-silk-300 flex w-full items-center gap-3 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5 text-left hover:bg-[var(--tint-slate-10)] focus-visible:ring-2 focus-visible:outline-none"
              :aria-label="fillTemplate(t('choreStars.awards.editAria'), { title: award.title })"
              data-testid="chore-rewards-award"
              :data-award-id="award.id"
              @click="openAwardForm(award)"
            >
              <span
                class="dark:bg-surface-hover grid h-9 w-9 flex-none place-items-center rounded-xl bg-white text-base"
                aria-hidden="true"
                >{{ award.emoji }}</span
              >
              <span class="min-w-0 flex-1">
                <span
                  class="font-outfit text-secondary-500 dark:text-ink block truncate text-sm font-semibold"
                  >{{ award.title }}</span
                >
                <span class="text-secondary-400 dark:text-ink-faint block text-xs">{{
                  awardLine(award)
                }}</span>
              </span>
              <span
                class="font-outfit text-secondary-500 dark:bg-surface-hover dark:text-ink-soft flex-none rounded-full bg-white px-2 py-0.5 text-xs font-semibold"
                >{{
                  t(
                    award.kind === 'week'
                      ? 'choreStars.awards.kind.week'
                      : 'choreStars.awards.kind.saved'
                  )
                }}</span
              >
            </button>
          </li>
        </ul>
      </section>
    </div>

    <!-- Column C: What Chores Are Worth. -->
    <div class="rewards-col contents">
      <section :class="cardClass" class="order-4" data-testid="chore-rewards-worth">
        <div>
          <h2 :class="sectionTitleClass">{{ t('choreStars.worth.title') }}</h2>
          <p :class="hintClass">{{ t('choreStars.worth.hint') }}</p>
        </div>

        <p v-if="!kids.length" class="text-secondary-500 dark:text-ink-soft text-sm">
          {{ t('choreStars.worth.noKids') }}
        </p>

        <template v-else-if="pickedKid">
          <div
            v-if="kids.length > 1"
            class="flex flex-wrap gap-2"
            role="group"
            :aria-label="t('choreStars.worth.pickChild')"
          >
            <button
              v-for="kid in kids"
              :key="kid.id"
              type="button"
              class="font-outfit text-secondary-500 dark:text-ink focus-visible:ring-sky-silk-300 inline-flex items-center gap-1.5 rounded-full border-2 py-1 pr-3 pl-1 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
              :class="
                kid.id === pickedKid.id
                  ? 'border-primary-500 dark:border-accent-lift bg-[var(--tint-orange-8)]'
                  : 'dark:border-line-strong dark:bg-surface-overlay border-[var(--tint-slate-10)] bg-white'
              "
              :aria-pressed="kid.id === pickedKid.id ? 'true' : 'false'"
              data-testid="chore-rewards-kid"
              :data-member-id="kid.id"
              @click="pickedKidId = kid.id"
            >
              <BeanieAvatar v-bind="memberAvatarBindings(kid)" size="xs" />
              {{ firstName(kid.name) }}
            </button>
          </div>

          <div
            v-if="kidStrip"
            class="dark:bg-surface-overlay rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5"
            data-testid="chore-rewards-preview"
          >
            <p class="font-outfit text-secondary-500 dark:text-ink-soft mb-1 text-xs font-semibold">
              {{ fillTemplate(t('choreStars.worth.preview'), { name: firstName(pickedKid.name) }) }}
            </p>
            <StarPathStrip
              :week="kidStrip.week"
              :path="kidStrip.path"
              :nearest="kidStrip.nearest"
              :this-week="kidStrip.thisWeek"
              :reward-title="rewards.title"
              :reward-emoji="rewardEmoji"
              :bar-pct="rewards.barPct"
              :member="pickedKid"
            />
          </div>

          <p
            v-if="!kidChores.length"
            class="text-secondary-500 dark:text-ink-soft text-sm"
            data-testid="chore-rewards-no-chores"
          >
            {{ fillTemplate(t('choreStars.worth.noChores'), { name: firstName(pickedKid.name) }) }}
          </p>
          <ul v-else class="flex flex-col gap-2" data-testid="chore-rewards-chores">
            <li
              v-for="chore in kidChores"
              :key="chore.id"
              class="flex items-center gap-2.5"
              data-testid="chore-rewards-chore"
              :data-chore-id="chore.id"
            >
              <span class="flex-none text-lg" aria-hidden="true">{{ choreEmoji(chore) }}</span>
              <span
                class="font-outfit text-secondary-500 dark:text-ink min-w-0 flex-1 text-sm font-semibold break-words"
                >{{ chore.title }}</span
              >
              <NumberStepper
                :model-value="starsOf(chore)"
                :min="CHORE_STARS_MIN"
                :max="CHORE_STARS_MAX"
                :label="fillTemplate(t('choreStars.worth.stepperLabel'), { chore: chore.title })"
                @update:model-value="setChoreStars(chore.id, $event)"
              />
            </li>
          </ul>

          <div
            v-if="kidWeek"
            class="dark:bg-surface-overlay flex items-center gap-2 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5"
            data-testid="chore-rewards-full-week"
          >
            <span class="text-secondary-500 dark:text-ink-soft min-w-0 flex-1 text-sm">{{
              fillTemplate(t('choreStars.worth.fullWeek'), { name: firstName(pickedKid.name) })
            }}</span>
            <StarCount :count="kidWeek.full" kind="value" />
          </div>
          <p :class="hintClass">{{ t('choreStars.worth.footnote') }}</p>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
/*
 * Layout only. On a phone the three column wrappers are `display: contents`, so the cards are
 * one column in the order their `order-*` classes give (on, weekly reward, awards, chore
 * values). From 1280px the wrappers become three columns, as the mockup draws them; below that
 * the single column is capped so a tablet does not stretch it into a slab.
 */
.rewards-layout {
  max-width: 40rem;
}

@media (width >= 80rem) {
  .rewards-layout {
    align-items: start;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr);
    max-width: none;
  }

  .rewards-col {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
}
</style>
