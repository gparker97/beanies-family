<script setup lang="ts">
/**
 * A shopping list from a recipe (#88) — review, then create.
 *
 * ⚠️ Lives in `components/pod/`, NOT `components/lists/`. No file in
 * `components/lists/` imports a domain component outside `lists/` and `ui/`; the
 * dependency direction is strictly one-way today, and a component taking a
 * `Recipe` prop would be the first edge back the other way.
 *
 * Nothing is created until the user saves, matching how document capture works
 * everywhere else in the app. What is in the textarea is what gets created.
 *
 * ## Why a textarea and not `ListItemRow`s
 *
 * State, not styling. Nothing is persisted yet. `ListItemRow` exists to edit a
 * SAVED `FamilyListItem` by id — it carries per-row draft state, `useInlineEdit`,
 * toggle/reorder/delete handlers and vuedraggable, all of which would have to be
 * re-implemented against a transient array with fabricated ids thrown away on
 * cancel. A textarea owns no per-item state, gives add/remove/reorder for free via
 * ordinary typing, and is the same control the user entered these ingredients with
 * (`RecipeFormModal`). Long lines also wrap in it — though note they still truncate
 * in `ListDetailModal` (`ListItemRow.vue`), which this change does not touch.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { isNative } from '@/services/sync/capabilities';
import { toISODateString } from '@/utils/date';
import { useListStore } from '@/stores/listStore';
import { useRecipeShoppingLists } from '@/composables/useRecipeShoppingLists';
import { useRecipesStore } from '@/stores/recipesStore';
import { buildRecipeListSeed, parseDraftItems, splitRecipeIngredients } from '@/utils/listSeed';
import type { RecipeIngredientSplit } from '@/utils/listSeed';
import { fillTemplate } from '@/utils/fillTemplate';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import type { Recipe } from '@/types/models';

const props = defineProps<{ open: boolean; recipe: Recipe }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const { getMemberName } = useMemberInfo();
const listStore = useListStore();
const recipesStore = useRecipesStore();

const draft = ref('');
const isSubmitting = ref(false);

/**
 * Who will do the shop, and when it needs doing.
 *
 * Both are set HERE rather than left to a follow-up edit in the list drawer,
 * because whoever builds a shopping list from a recipe generally already knows
 * both answers — and because the due date is what arms the reminder
 * (`buildListReminders`). Filling them in afterwards works identically (the
 * store replaces the lists array, the schedule recomputes), but it is a second
 * trip the user should not have to make.
 *
 * `ownerId` defaults to the current member on every open, matching
 * `NewListSheet.startBlank`. `dueDate` deliberately defaults to EMPTY: a due date
 * is a commitment, and defaulting one would arm a reminder the family never
 * asked for.
 */
const ownerId = ref('');
const dueDate = ref('');

/**
 * `review` when this recipe already has a list, `create` otherwise.
 *
 * The ingredients are shown either way — that is the point. A family arriving
 * here wants to know what is already on the list before deciding between opening
 * it and starting another, and answering that by navigating them out of the
 * cookbook made the choice for them. In `review` the lines are read-only, because
 * editing text that is not going to be saved anywhere is a lie.
 */
const mode = ref<'review' | 'create'>('create');

// Offered, never enforced — a second shop for the same dish is legitimate.
// ⚠️ Declared ABOVE the `immediate: true` watch below, which reads `existing` on
// mount. `<script setup>` is ordinary top-to-bottom execution, so a later `const`
// is in its temporal dead zone and the watch throws.
const {
  lists: existing,
  activeList,
  openList,
} = useRecipeShoppingLists(computed(() => props.recipe.id));

/**
 * The recipe → draft map, SNAPSHOT at open. Never recomputed while the sheet is up.
 *
 * A `computed` over `props.recipe.ingredients` would look equivalent and is not: the
 * recipe can change under us (an edit on another device), and `draft` is seeded only
 * in the watcher below — so the skipped-count would drift to describe ingredients the
 * textarea no longer reflects, while claiming in the UI to describe what the user is
 * looking at.
 */
const split = ref<RecipeIngredientSplit>({ titles: [], headingsSkipped: 0 });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    split.value = splitRecipeIngredients(props.recipe.ingredients ?? []);
    draft.value = split.value.titles.join('\n');
    isSubmitting.value = false;
    // Reset BOTH on every open, not just the first: the sheet instance is reused
    // across recipes, and inheriting the last recipe's due date would silently
    // schedule a reminder for a shop the user never dated.
    ownerId.value = familyStore.currentMember?.id ?? '';
    dueDate.value = '';
    // Any existing list counts, finished or not: a done shop is still the answer
    // to "have I already made one of these?", and the row shows its progress so
    // the user can tell at a glance.
    mode.value = existing.value.length > 0 ? 'review' : 'create';
    logEvent({
      level: 'info',
      surface: 'list-from-recipe',
      message: 'recipe shopping-list sheet opened',
      context: { action: 'sheet_opened' },
    });
  },
  { immediate: true }
);

/** Past tense, and about the RECIPE — it does not move as the user edits. */
const skippedHint = computed(() => {
  const n = split.value.headingsSkipped;
  if (n === 0) return '';
  return n === 1
    ? t('lists.fromRecipe.headingsSkipped.one')
    : fillTemplate(t('lists.fromRecipe.headingsSkipped.other'), { count: String(n) });
});

const items = computed(() => parseDraftItems(draft.value));

/** The list the primary action opens: the newest still being shopped, else the newest. */
const openTarget = computed(() => activeList.value ?? existing.value[0] ?? null);

const saveDisabled = computed(() =>
  mode.value === 'review' ? !openTarget.value : items.value.length === 0
);
const saveLabel = computed(() =>
  mode.value === 'review' ? t('lists.fromRecipe.openExisting') : t('lists.fromRecipe.save')
);

/** `FamilyChipPicker` emits `string | string[]`; single mode gives a string. */
function setOwner(value: string | string[]): void {
  const id = Array.isArray(value) ? value[0] : value;
  if (id) ownerId.value = id;
}

/**
 * Says out loud what a due date actually does, and only once one is set.
 *
 * Arming a notification is not something a date field normally implies, so the
 * consequence is stated at the moment the user chooses it rather than discovered
 * the next morning. Names the OWNER, not "you" — the whole point of the picker
 * above is that those are often different people.
 *
 * ⚠️ Two things it must NOT do, both found in review:
 *  • Promise a notification on a platform that never arms one.
 *    `useLocalNotifications` returns at `if (!isNative()) return`, and there is no
 *    service-worker fallback — on web and the PWA no OS reminder exists at all, so
 *    there the hint says what DOES happen (the list shows up as due) and nothing
 *    about notifications.
 *  • Name a literal time. "9am" would duplicate `ALL_DAY_REMINDER_HOUR` across
 *    three locales, so tuning the constant would silently make the copy lie. The
 *    string says "that morning"; the constant stays the single source of truth.
 */
const dueHint = computed(() => {
  if (mode.value !== 'create' || !dueDate.value) return '';
  const key = isNative() ? 'lists.fromRecipe.dueHint' : 'lists.fromRecipe.dueHintWeb';
  return fillTemplate(t(key), {
    name: getMemberName(ownerId.value, t('lists.fromRecipe.someone')),
  });
});

/** Today, ymd — the date picker's floor. A due date in the past arms no reminder
 *  (`listFireTime`'s moment is already gone), so offering one is a trap. */
const todayYmd = computed(() => toISODateString(new Date()));

/** Progress for a row, so a finished shop is obvious without opening it. */
function progressFor(l: { items: Array<{ completed: boolean }> }): string {
  const done = l.items.filter((i) => i.completed).length;
  return `${done}/${l.items.length}`;
}

/** Leave review and let the user edit — the lines become theirs to change. */
function startNewList(): void {
  mode.value = 'create';
}

/** The modal's one primary action, whichever mode we are in. */
function onPrimary(): void {
  if (mode.value === 'review') {
    if (openTarget.value) openExisting(openTarget.value.id);
    return;
  }
  void onSave();
}

function openExisting(id: string): void {
  emit('close');
  openList(id);
}

async function onSave(): Promise<void> {
  // Guard AND the bound `is-submitting`: one write is atomic, which prevents a
  // partial list, not a second list. Without this a double-tap makes two.
  if (isSubmitting.value || saveDisabled.value) return;

  const memberId = familyStore.currentMember?.id;
  if (!memberId) {
    // A list with a dangling ownerId is worse than a failure the user can retry —
    // the same call `copyListForMembers` makes. Refuse, explain, report.
    // `silent` because we report this ourselves below under a precise surface —
    // an un-silenced error toast auto-reports on the catch-all `app` surface, so
    // one failure would emit two firehose events and double any rate built on
    // `action`. Same discipline as `CalendarSyncSettings.vue`.
    showToast('error', t('lists.fromRecipe.noMemberError'), t('lists.fromRecipe.noMemberHelp'), {
      silent: true,
    });
    reportError({
      surface: 'list-from-recipe',
      message:
        'no current member — refusing to create a list with an empty ownerId. Check familyStore.currentMember is resolved before this sheet can open.',
      severity: 'error',
      context: { action: 'no_current_member' },
    });
    return;
  }

  // The recipe can be deleted on another device while this sheet is open; its
  // cascade has already been and gone, so a link written now would dangle forever.
  // Read the STORE mirror the page renders, never the projection (MVO).
  if (!recipesStore.recipes.some((r) => r.id === props.recipe.id)) {
    showToast('error', t('lists.fromRecipe.recipeGoneError'), t('lists.fromRecipe.recipeGoneHelp'));
    return;
  }

  // Same hazard, the other field: the chosen owner can be removed from the family
  // on another device while this sheet is open. The picker cannot offer a bad id,
  // so this only fires on that race — but a list owned by nobody shows up in no
  // one's briefing and arms no one's reminder, which is a silent loss.
  const owner = ownerId.value || memberId;
  if (!familyStore.members.some((m) => m.id === owner)) {
    showToast('error', t('lists.fromRecipe.ownerGoneError'), t('lists.fromRecipe.ownerGoneHelp'), {
      silent: true, // see the note on the no-member guard above
    });
    reportError({
      surface: 'list-from-recipe',
      message:
        'chosen list owner is no longer a family member — refusing to create a list nobody owns. Likely a member removed on another device while the sheet was open.',
      severity: 'error',
      context: { action: 'owner_unresolved' },
    });
    return;
  }

  isSubmitting.value = true;
  try {
    const created = await listStore.createList(
      buildRecipeListSeed({
        recipeId: props.recipe.id,
        titles: items.value,
        title: fillTemplate(t('lists.fromRecipe.listTitle'), { recipe: props.recipe.name }),
        ownerId: owner,
        // NOT `owner` — the creator is whoever is standing here, and the
        // `list-completed` bell entry depends on the two being distinguishable.
        createdBy: memberId,
        dueDate: dueDate.value,
      })
    );
    // Falsy, not `=== null`: the store folds a throw and a graceful stop into one
    // sentinel and has already toasted + reported either way. A second toast here
    // would page twice. Deliberately does NOT close — the draft survives for a retry.
    if (!created) return;
    logEvent({
      level: 'info',
      surface: 'list-from-recipe',
      message: 'shopping list created from recipe',
      context: {
        action: 'list_created',
        ingredient_count: items.value.length,
        count: split.value.headingsSkipped,
      },
    });
    // ⚠️ An action toast, not a bare one. Before this, creating a list ended in a
    // message with nowhere to go — the user was told it existed and left on the
    // recipe with no route to it. The longer dismiss is what the `durationMs`
    // override exists for: an action nobody has time to tap is not an action.
    // (Interactive toasts are exempt from dedupe, so two shops in a row both keep
    // their own View.)
    showToast('success', t('lists.fromRecipe.created'), undefined, {
      actionLabel: t('lists.fromRecipe.view'),
      actionFn: () => openList(created.id),
      durationMs: 8000,
    });
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('lists.fromRecipe.title')"
    icon="🛒"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="saveLabel"
    :save-disabled="saveDisabled"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onPrimary"
  >
    <div class="space-y-4">
      <p class="font-inter dark:text-ink-soft text-sm text-[var(--color-text-muted)]">
        {{ mode === 'review' ? t('lists.fromRecipe.reviewBody') : t('lists.fromRecipe.body') }}
      </p>

      <!-- The lists this recipe has already produced. Each row carries its own
           progress, so a shop that is finished is obvious without opening it. -->
      <div v-if="mode === 'review'" class="space-y-1">
        <button
          v-for="l in existing"
          :key="l.id"
          type="button"
          class="dark:border-line dark:hover:bg-surface-hover flex w-full items-center gap-2 rounded-xl border-2 border-[var(--tint-slate-10)] px-3 py-2 text-left transition-colors hover:bg-[var(--tint-slate-04)]"
          @click="openExisting(l.id)"
        >
          <span aria-hidden="true">{{ l.emoji }}</span>
          <span class="min-w-0 flex-1">
            <span class="font-inter dark:text-ink block truncate text-sm font-semibold">
              {{ l.title }}
            </span>
            <span class="font-inter dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
              {{ progressFor(l) }}
            </span>
          </span>
          <!-- The house "Open list ›" affordance (`LinkedLists`). Without it the row
               is a button that does not look like one — greg could not tell it was
               tappable. -->
          <span
            class="font-outfit text-primary-600 dark:text-accent-lift inline-flex flex-shrink-0 items-center gap-0.5 text-xs font-semibold"
            >{{ t('lists.embed.open') }}<span aria-hidden="true">›</span></span
          >
        </button>
      </div>

      <!-- Read-only in review: these lines are not going anywhere, and an editable
           box that discards what you type is worse than a plain one. -->
      <div v-if="mode === 'review'" class="space-y-1">
        <p
          class="font-inter dark:text-ink-faint text-xs font-semibold text-[var(--color-text-muted)] uppercase"
        >
          {{ t('lists.fromRecipe.ingredientsLabel') }}
          <span class="font-inter normal-case">· {{ t('lists.fromRecipe.readOnly') }}</span>
        </p>
        <!-- ⚠️ Deliberately NOT the textarea's look. A tinted fill, a 1px border and
             no focus ring are what say "you cannot type here" — the editable box is
             white, 2px, with a focus ring. Muted INK rather than an opacity, because
             this is text the user is meant to READ (CLAUDE.md: never put an opacity
             modifier on readable text). It disappears the moment they start another
             list and the editable box takes its place. -->
        <ul
          class="dark:border-line dark:bg-surface-ground max-h-56 overflow-y-auto rounded-xl border border-[var(--tint-slate-10)] bg-[var(--tint-slate-04)] px-4 py-3"
          aria-readonly="true"
        >
          <li
            v-for="(line, i) in split.titles"
            :key="i"
            class="font-inter dark:text-ink-soft py-0.5 text-sm leading-relaxed text-[var(--color-text-muted)]"
          >
            {{ line }}
          </li>
        </ul>
      </div>

      <textarea
        v-else
        v-model="draft"
        rows="10"
        :aria-label="t('lists.fromRecipe.itemsLabel')"
        class="focus:border-primary-500 focus:ring-primary-500 font-inter dark:border-line-strong dark:bg-surface-overlay dark:text-ink w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-base leading-relaxed text-[var(--color-text)] outline-none focus:ring-1"
      ></textarea>

      <!-- Renders nothing when there is nothing to say, so no `v-if` here. -->
      <InferredHint v-if="mode === 'create'" :text="skippedHint" />

      <!-- Who is shopping, and by when. Asked HERE because the person building a
           list from a recipe usually already knows both, and because the due date
           is what arms the reminder — making them go and find the list afterwards
           to add it is the trip this section removes. -->
      <div v-if="mode === 'create'" class="space-y-3 border-t border-[var(--color-border)] pt-4">
        <div class="space-y-1.5">
          <p
            class="font-inter dark:text-ink-faint text-xs font-semibold text-[var(--color-text-muted)] uppercase"
          >
            {{ t('lists.fromRecipe.ownerLabel') }}
          </p>
          <FamilyChipPicker
            :model-value="ownerId"
            mode="single"
            compact
            @update:model-value="setOwner"
          />
        </div>

        <!-- ⚠️ NO sibling <p> label here. `BeanieDatePicker` renders its own visible
             <label> from `:label`, so adding one stacked "NEEDED BY" above
             "NEEDED BY" in two different faces and announced it twice. The owner
             block above has no such built-in, which is why it keeps its <p>.
             The key is `lists.detail.dueDateLabel`, reused from ListDetailModal
             rather than a new one: it is the same field, and the new string's zh
             auto-translation read "Needed by" as "by whom" and labelled a date
             picker with a person. -->
        <div class="space-y-1.5">
          <BeanieDatePicker
            v-model="dueDate"
            :label="t('lists.detail.dueDateLabel')"
            :min="todayYmd"
            :placeholder="t('lists.fromRecipe.dueDatePlaceholder')"
          />
          <InferredHint :text="dueHint" />
        </div>
      </div>

      <!-- The quieter half of the choice. Editing is unlocked in place: no second
           modal, no navigation, and the lines they were just reading stay put. -->
      <button
        v-if="mode === 'review'"
        type="button"
        class="font-inter text-primary-600 dark:text-accent-lift text-sm font-semibold underline underline-offset-2"
        data-testid="recipe-list-start-another"
        @click="startNewList"
      >
        {{ t('lists.fromRecipe.startAnother') }}
      </button>
    </div>
  </BeanieFormModal>
</template>
