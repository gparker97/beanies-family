<script setup lang="ts">
/**
 * "Start a New List": a category, a template, or a blank list.
 *
 * The choreboard redirect (#146, flag `choreboard` on): chores always start on the choreboard,
 * never as a list. The sheet gains a "Making a chores list for the kids?" row, and the two
 * chore templates stay visible, tagged "On the Choreboard". Choosing either swaps the sheet's
 * body for a one-sentence confirm: "Go to the Choreboard" lands on its Starter Sets with the
 * matching set and the people picked here (`/choreboard?starter=<set>&for=<id,id>`, the query
 * `ChoreboardPage` parses and validates), "Stay Here" brings the sheet back as it was. A
 * non-adult sees only "Ask a grown-up ..." and Stay Here. `listStore.createFromTemplate` is
 * never called for a chore template while the flag is on. `hideChores` (a host whose new list
 * carries a link, `LinkedListsSection`) hides the row and both templates, because a redirect
 * there would drop the link. The flag is read once, here.
 *
 * Dark mode: the row and the tagged tiles paint `--tint-orange-8` (dark value in `style.css`)
 * with an accent border that lifts on dark; text is `ink` / `ink-soft`, accents `accent-lift`.
 * The glyph chip is the brand orange gradient with an emoji, the same in both modes.
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useCardDefaultHint } from '@/composables/useCardDefaultHint';
import { logEvent } from '@/services/telemetry/logEvent';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { LIST_TEMPLATES, getListTemplatesForCategory } from '@/constants/listTemplates';
import {
  CHORE_TEMPLATE_TO_STARTER,
  choreStarterSet,
  type ChoreStarterSetKey,
} from '@/constants/choreStarterSets';
import { isFlagEnabled } from '@/config/flags';
import { usePermissions } from '@/composables/usePermissions';
import { formatNameList } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import ListCategoryPills from './ListCategoryPills.vue';
import ListPeoplePicker from './ListPeoplePicker.vue';
import type { CreateFamilyListInput, ListCategory } from '@/types/models';

const props = defineProps<{
  open: boolean;
  /**
   * Caller-fixed fields for the new list (e.g. the activity link, #114), spread LAST into both
   * create paths so they always win over the sheet's own choices (category pill, card holder).
   */
  overrides?: Partial<CreateFamilyListInput>;
  /** A template to list first with a "Suggested" badge (e.g. party prep on a birthday). */
  suggestedTemplateKey?: string;
  /**
   * The category "Start Blank List" uses when no category pill is picked (e.g. Trips on a
   * trip). Unset means the store's own default (Home).
   */
  blankCategory?: ListCategory;
  /** Stack above another open drawer (e.g. when opened from the activity drawer). */
  stacked?: boolean;
  /**
   * Hide the choreboard redirect (the kids row and both chore templates) while the
   * `choreboard` flag is on: a host whose new list carries a link (a trip, an activity, a Who
   * Owns What card) would lose it on the way to the choreboard.
   */
  hideChores?: boolean;
}>();
// `templateKey` is set when the list came from a template, absent for a blank list.
const emit = defineEmits<{
  close: [];
  created: [id: string, templateKey?: string];
  /**
   * The create returned nothing. The store has already surfaced why: a toast + report for
   * a refused owner or a failed write, an error event for an unknown template key.
   */
  failed: [templateKey?: string];
}>();

const { t } = useTranslation();
const listStore = useListStore();
const familyStore = useFamilyStore();
const router = useRouter();

/** The flag, read once per surface. With it off the sheet is exactly what it was. */
const choreboardOn = isFlagEnabled('choreboard');
/** Chores start on the choreboard from this sheet (the row, the tags, the confirm). */
const choresOnBoard = computed(() => choreboardOn && !props.hideChores);
/** The two chore templates, hidden outright where the redirect would drop a link. */
const choresHidden = computed(() => choreboardOn && !!props.hideChores);
const isChoreTemplate = (key: string): boolean => key in CHORE_TEMPLATE_TO_STARTER;
/** The choreboard's glyph (its nav emoji), decorative beside real text. */
const CHOREBOARD_GLYPH = '🧹';

const meId = computed(() => familyStore.currentMember?.id ?? '');
const selectedCategory = ref<ListCategory | null>(null);

/**
 * Who the new list is for (#147). Untouched (null), it reads as the creator, and a template
 * mapped to a Who Owns What card still goes to that card's holder; once someone changes the
 * row, their choice wins for every template. Never empty: `ListPeoplePicker` refuses a pick
 * that leaves nobody.
 */
const pickedPeople = ref<string[] | null>(null);
const people = computed(() => pickedPeople.value ?? (meId.value ? [meId.value] : []));

const templates = computed(() => {
  const all = selectedCategory.value
    ? getListTemplatesForCategory(selectedCategory.value)
    : LIST_TEMPLATES;
  const shown = choresHidden.value ? all.filter((tmpl) => !isChoreTemplate(tmpl.key)) : all;
  const suggested = shown.find((tmpl) => tmpl.key === props.suggestedTemplateKey);
  return suggested ? [suggested, ...shown.filter((tmpl) => tmpl !== suggested)] : shown;
});

function reset(): void {
  selectedCategory.value = null;
  pickedPeople.value = null;
  redirect.value = null;
}
function close(): void {
  reset();
  emit('close');
}

// Who Owns What (#109): a template mapped to a card (`CARD_DEFAULTS.listTemplate`) owns
// the new list with that card's single holder. The hint shows on the tile BEFORE the pick
// (the sheet closes on pick) and is derived, never stored.
const { holderFor, holdsHint } = useCardDefaultHint();
const tileHints = computed<Record<string, string>>(() =>
  // A chosen "Who's it for?" replaces the card default, so the hint would no longer be true.
  pickedPeople.value
    ? {}
    : Object.fromEntries(
        templates.value.map((tmpl) => [
          tmpl.key,
          holdsHint({ kind: 'listTemplate', key: tmpl.key }),
        ])
      )
);

/**
 * One create at a time. Without it a double tap makes two lists, and a host that discards an
 * untouched blank (`LinkedListsSection`) only tracks the second, leaving the first linked and
 * empty.
 */
const isCreating = ref(false);
async function createOnce(run: () => Promise<void>): Promise<void> {
  if (isCreating.value) return;
  isCreating.value = true;
  try {
    await run();
  } finally {
    isCreating.value = false;
  }
}

function pickTemplate(key: string): Promise<void> {
  if (choresOnBoard.value && isChoreTemplate(key)) {
    const tmpl = LIST_TEMPLATES.find((x) => x.key === key);
    openRedirect(key, CHORE_TEMPLATE_TO_STARTER[key]!, tmpl?.nameKey);
    return Promise.resolve();
  }
  return createOnce(() => createFromTemplate(key));
}

// ── The choreboard redirect (#146) ──────────────────────────────────────────

/** The row's detail in telemetry (the template keys are the tiles' own). */
const KIDS_ROW = 'kids-row';
/** The kids row lands where the Kids' chores template does. */
const KIDS_ROW_STARTER: ChoreStarterSetKey = CHORE_TEMPLATE_TO_STARTER['kids-chores']!;

/** The confirm on show: what was tapped, the set it lands on, and that set's name to say. */
const redirect = ref<{ detail: string; starter: ChoreStarterSetKey; nameKey?: UIStringKey } | null>(
  null
);
const { isAdult } = usePermissions();
/**
 * Who the chores are for: only people picked in the row. Untouched, the row reads as the
 * creator, who is not who a kids' chores list is for, so nobody is carried and the Starter
 * Sets sheet asks.
 */
const choreFor = computed(() => pickedPeople.value ?? []);

const redirectBody = computed(() => {
  const r = redirect.value;
  if (!r) return '';
  const set = r.nameKey ? t(r.nameKey) : '';
  const names = choreFor.value
    .map((id) => familyStore.members.find((m) => m.id === id)?.name)
    .filter((n): n is string => !!n);
  return names.length
    ? fillTemplate(t('lists.new.choresBody'), { set, names: formatNameList(names) })
    : fillTemplate(t('lists.new.choresBodyNoPeople'), { set });
});

function logRedirect(action: 'go' | 'stay' | 'ask-grown-up', detail: string): void {
  logEvent({
    level: 'info',
    surface: 'choreboard',
    message: 'lists-redirect',
    context: { action, detail },
  });
}

function openRedirect(detail: string, starter: ChoreStarterSetKey, nameKey?: UIStringKey): void {
  redirect.value = { detail, starter, nameKey };
  // A child can only be asked to fetch a grown-up; that is the whole outcome.
  if (!isAdult.value) logRedirect('ask-grown-up', detail);
}

function pickKidsRow(): void {
  openRedirect(KIDS_ROW, KIDS_ROW_STARTER, choreStarterSet(KIDS_ROW_STARTER)?.nameKey);
}

function stayHere(): void {
  const r = redirect.value;
  if (r && isAdult.value) logRedirect('stay', r.detail);
  redirect.value = null;
}

function goToChoreboard(): void {
  const r = redirect.value;
  if (!r || !isAdult.value) return;
  const ids = choreFor.value;
  logRedirect('go', r.detail);
  close();
  router
    .push({
      path: '/choreboard',
      query: ids.length ? { starter: r.starter, for: ids.join(',') } : { starter: r.starter },
    })
    .catch((error: unknown) => {
      logEvent({
        level: 'error',
        surface: 'choreboard',
        message: 'lists-redirect-failed',
        context: { detail: r.detail },
        error,
      });
    });
}

async function createFromTemplate(key: string): Promise<void> {
  const overrides: Partial<CreateFamilyListInput> = selectedCategory.value
    ? { category: selectedCategory.value }
    : {};
  // `meId` stays the creator (`createdBy`); the people come from the row, or from the card
  // when the row was left as it opened.
  const holder = pickedPeople.value ? null : holderFor({ kind: 'listTemplate', key });
  overrides.assigneeIds = holder ? [holder.memberId] : people.value;
  if (holder) {
    logEvent({
      level: 'info',
      surface: 'lists',
      message: 'card_default_applied',
      context: { action: 'card_default_applied', detail: key },
    });
  }
  const created = await listStore.createFromTemplate(key, meId.value, {
    ...overrides,
    ...props.overrides,
  });
  if (created) emit('created', created.id, key);
  else emit('failed', key);
  close();
}

function startBlank(): Promise<void> {
  return createOnce(async () => {
    const created = await listStore.createBlankList(meId.value, {
      category: selectedCategory.value ?? props.blankCategory,
      assigneeIds: people.value,
      ...props.overrides,
    });
    if (created) emit('created', created.id);
    else emit('failed');
    close();
  });
}

// Watch open → reset selection when (re)opened.
const isOpen = computed(() => props.open);
</script>

<template>
  <BaseModal
    :open="isOpen"
    :title="t('lists.new.title')"
    size="lg"
    :layer="stacked ? 'overlay' : 'base'"
    @close="close"
  >
    <!-- The choreboard confirm (#146): replaces the body until Go or Stay Here -->
    <div
      v-if="redirect"
      class="flex flex-col items-center gap-3 py-4 text-center"
      data-testid="chores-redirect-confirm"
    >
      <span
        class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--tint-orange-15)] text-3xl"
        aria-hidden="true"
        >{{ CHOREBOARD_GLYPH }}</span
      >
      <template v-if="isAdult">
        <p class="font-outfit dark:text-ink text-lg font-bold text-[var(--color-text)]">
          {{ t('lists.new.choresHome') }}
        </p>
        <p
          class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]"
          data-testid="chores-redirect-body"
        >
          {{ redirectBody }}
        </p>
        <BaseButton
          variant="primary"
          class="mt-1 w-full"
          data-testid="chores-redirect-go"
          @click="goToChoreboard"
        >
          {{ t('lists.new.choresGo') }}
        </BaseButton>
      </template>
      <p
        v-else
        class="font-outfit dark:text-ink text-base font-bold text-[var(--color-text)]"
        data-testid="chores-redirect-ask"
      >
        {{ t('lists.new.choresAskGrownUp') }}
      </p>
      <BaseButton
        variant="ghost"
        class="w-full"
        data-testid="chores-redirect-stay"
        @click="stayHere"
      >
        {{ t('lists.new.choresStay') }}
      </BaseButton>
    </div>

    <div v-else class="space-y-5">
      <p class="text-sm text-[var(--color-text-muted)]">{{ t('lists.new.subtitle') }}</p>

      <!-- Chores live on the choreboard (#146): the friendly way there -->
      <button
        v-if="choresOnBoard"
        type="button"
        class="border-primary-500 dark:border-accent-lift flex w-full items-center gap-3 rounded-2xl border-[1.5px] bg-[var(--tint-orange-8)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--tint-orange-15)]"
        data-testid="new-list-chores-row"
        @click="pickKidsRow"
      >
        <span
          class="chores-glyph flex h-10 w-10 flex-none items-center justify-center rounded-xl text-xl"
          aria-hidden="true"
          >{{ CHOREBOARD_GLYPH }}</span
        >
        <span class="min-w-0 flex-1">
          <span class="font-outfit dark:text-ink block text-sm font-bold text-[var(--color-text)]">
            {{ t('lists.new.choresRow') }}
          </span>
          <span class="dark:text-ink-soft block text-xs text-[var(--color-text-muted)]">
            {{ t('lists.new.choresHome') }}
          </span>
        </span>
        <span class="font-outfit text-primary-600 dark:text-accent-lift text-xl" aria-hidden="true"
          >›</span
        >
      </button>

      <!-- Who it is for: starts with the creator; several allowed, never nobody -->
      <div data-testid="new-list-people">
        <p class="lists-label">{{ t('lists.new.whoLabel') }}</p>
        <ListPeoplePicker
          :model-value="people"
          hint-testid="new-list-people-hint"
          @update:model-value="(ids) => (pickedPeople = ids)"
        >
          <template #hint>
            <p class="dark:text-ink-faint mt-1.5 text-xs text-[var(--color-text-muted)]">
              {{ t('lists.new.whoHint') }}
            </p>
          </template>
        </ListPeoplePicker>
      </div>

      <!-- Category pills -->
      <div>
        <p class="lists-label">{{ t('lists.new.categoryLabel') }}</p>
        <ListCategoryPills v-model="selectedCategory" clearable short />
      </div>

      <!-- Templates -->
      <div>
        <p class="lists-label">{{ t('lists.new.templatesLabel') }}</p>
        <div class="grid grid-cols-2 gap-2.5">
          <button
            v-for="tmpl in templates"
            :key="tmpl.key"
            type="button"
            class="flex flex-col gap-1 rounded-2xl p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--color-primary-500)] hover:shadow-md"
            :class="
              choresOnBoard && isChoreTemplate(tmpl.key)
                ? 'border-primary-500 dark:border-accent-lift border-[1.5px] border-dashed bg-[var(--tint-orange-8)]'
                : 'dark:bg-surface-raised dark:border-line-strong border border-[var(--color-border)] bg-white'
            "
            :data-testid="
              choresOnBoard && isChoreTemplate(tmpl.key) ? 'new-list-chore-template' : undefined
            "
            @click="pickTemplate(tmpl.key)"
          >
            <span class="flex items-start justify-between gap-2">
              <span class="text-2xl" aria-hidden="true">{{ tmpl.icon }}</span>
              <span
                v-if="choresOnBoard && isChoreTemplate(tmpl.key)"
                class="chores-glyph flex h-7 w-7 flex-none items-center justify-center rounded-lg text-sm"
                aria-hidden="true"
                >{{ CHOREBOARD_GLYPH }}</span
              >
              <span
                v-else-if="tmpl.key === suggestedTemplateKey"
                class="font-outfit text-primary-600 dark:text-accent-lift rounded-full bg-[var(--tint-orange-15)] px-2 py-px text-xs font-bold"
                data-testid="suggested-badge"
                >{{ t('lists.new.suggested') }}</span
              >
            </span>
            <span class="font-outfit text-sm font-bold text-[var(--color-text)]">{{
              t(tmpl.nameKey)
            }}</span>
            <span class="text-xs text-[var(--color-text-muted)]">{{ t(tmpl.descriptionKey) }}</span>
            <span
              v-if="choresOnBoard && isChoreTemplate(tmpl.key)"
              class="font-outfit text-primary-600 dark:text-accent-lift mt-1 self-start rounded-full bg-[var(--tint-orange-15)] px-2 py-px text-xs font-bold whitespace-nowrap"
              data-testid="chores-tag"
              >{{ t('lists.new.choresTag') }}</span
            >
            <!-- A card holder hint would not be true of a tile that creates no list -->
            <InferredHint
              :text="choresOnBoard && isChoreTemplate(tmpl.key) ? '' : tileHints[tmpl.key]"
            />
          </button>
        </div>
      </div>

      <BaseButton variant="primary" class="w-full" @click="startBlank">
        {{ t('lists.new.blank') }}
      </BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
/* The choreboard's glyph chip: the brand orange gradient, the same in both modes (it carries
   an emoji, never text). */
.chores-glyph {
  background: linear-gradient(135deg, #f15d22, #e67e22);
}

.lists-label {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}
</style>
