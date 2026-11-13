<script setup lang="ts">
/**
 * Edit a chore on the choreboard (#146). Grown-ups only (the page never opens it for a child,
 * and the store refuses a child anyway). New chores, one or a whole set, are added in the Add
 * Chores sheet (`ChoreAddSheet`); this is the screen for changing or deleting one that exists.
 * A chore has a name, who, a time of day, which days and a picture; everything is chips and
 * tiles. Keep Parents Posted is the per-chore `NotifyParentsToggle`, shown only for a chore that
 * is for children only (`isChildOnly`), the same rule as lists and to-dos.
 *
 * The picture is decorative and sits LAST, folded behind a quiet "Change Picture" disclosure;
 * the preview beside the name always shows it. Editing never changes a picture by itself.
 *
 * Required: a title and at least one living person (`useFormValidation`, never a disabled Save);
 * "Pick Days" needs at least one day. Save always goes to `updateChore` for `choreId`: a chore
 * deleted on another device while the form was open is the store's `not-found` refusal (its
 * toast), and the form closes, because there is nothing left to retry.
 *
 * Delete goes through the ConfirmModal tier. A chore shared by several beans says who it comes
 * off the board for; opened from a bean (`beanId`), the confirm also offers removing it for that
 * bean only (`removeChoresForMember`), which is the default.
 *
 * MUST stay mounted while closed (like `ListCopyModal`): `useFormModal` seeds on the open
 * transition, so a `v-if`-gated instance could open unseeded.
 *
 * Dark mode: the block tiles paint `--chore-tint` / `--chore-ink` (dark partners in
 * `src/style.css`); the selected tile's ring is Heritage Orange; the disclosure is `accent-lift`
 * text on dark; the picture choice is the shared `ChorePicturePicker`.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ChipButton from '@/components/ui/ChipButton.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import NotifyParentsToggle from '@/components/ui/NotifyParentsToggle.vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import ListPeoplePicker from '@/components/lists/ListPeoplePicker.vue';
import ChorePicturePicker from '@/components/chores/ChorePicturePicker.vue';
import { confirm, confirmChoice } from '@/composables/useConfirm';
import { useFormModal } from '@/composables/useFormModal';
import { useFormValidation } from '@/composables/useFormValidation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useSounds } from '@/composables/useSounds';
import { useTranslation } from '@/composables/useTranslation';
import { useChoreStore, type ChoreDraft } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import {
  CHORE_BLOCK_META,
  CHORE_TITLE_MAX,
  DEFAULT_CHORE_EMOJI,
  choreArtSrc,
  choreEmoji,
} from '@/constants/choreBlocks';
import { canSetNotifyParents, isChildOnly } from '@/utils/audience';
import { firstName, formatNameList, membersByIds } from '@/utils/assignees';
import {
  CHORE_BLOCKS,
  SCHOOL_DAYS,
  WEEKEND_DAYS,
  choreDaysKind,
  livingAssignees,
} from '@/utils/chores';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatTime12 } from '@/utils/date';
import type { Chore, ChoreBlock } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** The chore to edit. */
    choreId?: string | null;
    /** The bean whose card or day the form was opened from (offers "only for them" on delete). */
    beanId?: string | null;
  }>(),
  { choreId: null, beanId: null }
);

const emit = defineEmits<{ close: []; saved: [id: string]; deleted: [] }>();

const { t } = useTranslation();
const choreStore = useChoreStore();
const familyStore = useFamilyStore();
const { getMemberById } = useMemberInfo();
const { playWhoosh } = useSounds();

type DaysMode = 'every' | 'school' | 'weekends' | 'pick';
const DAYS_MODES: readonly { value: DaysMode; labelKey: UIStringKey }[] = [
  { value: 'every', labelKey: 'choreboard.form.days.every' },
  { value: 'school', labelKey: 'choreboard.form.days.school' },
  { value: 'weekends', labelKey: 'choreboard.form.days.weekends' },
  { value: 'pick', labelKey: 'choreboard.form.days.pick' },
];

const title = ref('');
const emoji = ref(DEFAULT_CHORE_EMOJI);
const illustration = ref('');
const assigneeIds = ref<string[]>([]);
const block = ref<ChoreBlock>('morning');
const days = ref<number[]>([]);
const daysMode = ref<DaysMode>('every');
const notifyParents = ref(false);
/** The "Change Picture" disclosure; folded on every open. */
const pictureOpen = ref(false);

const editing = computed<Chore | undefined>(() =>
  props.choreId ? choreStore.choreById(props.choreId) : undefined
);

/** The days shortcut a stored weekday set reads as (`choreDaysKind`, shared with the sheet). */
function modeFor(d: readonly number[]): DaysMode {
  const kind = choreDaysKind(d);
  return kind === 'some' ? 'pick' : kind;
}

/** Bumped on every open, so a save from an earlier open never closes this one. */
let generation = 0;

function seed(chore: Chore | undefined): void {
  generation++;
  isSubmitting.value = false;
  pictureOpen.value = false;
  title.value = chore?.title ?? '';
  emoji.value = chore ? choreEmoji(chore) : DEFAULT_CHORE_EMOJI;
  illustration.value = chore?.illustration ?? '';
  assigneeIds.value = [...(chore?.assigneeIds ?? [])];
  block.value = chore && CHORE_BLOCKS.includes(chore.block) ? chore.block : 'anytime';
  days.value = [...(chore?.days ?? [])];
  daysMode.value = modeFor(days.value);
  notifyParents.value = !!chore?.notifyParents;
}

// `snapshot`: an edit diffs against the values the form was SEEDED with at open, not against the
// live chore. A grown-up's untouched field must never overwrite an edit another device made to
// it while this form was open (diffing against the live chore wrote the seeded value back).
// `onNew` only runs when the chore was already gone as the form opened: it seeds blank, and
// Save then meets the store's `not-found` refusal.
const { isSubmitting, formDiff } = useFormModal<Chore, ChoreDraft>(
  () => editing.value,
  () => props.open,
  {
    onEdit: seed,
    onNew: () => seed(undefined),
    entityKey: () => props.choreId,
    snapshot: { build: () => buildDraft(), name: 'ChoreFormModal' },
  }
);

const livingPicked = computed(() => assigneeIds.value.filter((id) => choreStore.livingIds.has(id)));
const childOnly = computed(() => isChildOnly(livingPicked.value, getMemberById));
const notifyParentsShown = computed(
  () => childOnly.value && canSetNotifyParents(familyStore.currentMember)
);

const v = useFormValidation(
  'chore',
  () => ({
    title: () => title.value.trim().length > 0,
    who: () => livingPicked.value.length > 0,
    ...(daysMode.value === 'pick' ? { days: () => days.value.length > 0 } : {}),
  }),
  { open: () => props.open }
);

function pickDaysMode(mode: DaysMode): void {
  daysMode.value = mode;
  if (mode === 'every') days.value = [];
  else if (mode === 'school') days.value = [...SCHOOL_DAYS];
  else if (mode === 'weekends') days.value = [...WEEKEND_DAYS];
  // 'pick' keeps the current days, so a grown-up can adjust a preset.
}

function onDaysPicked(value: number[]): void {
  days.value = value;
  daysMode.value = 'pick';
}

function blockTime(b: ChoreBlock): string {
  return b === 'anytime' ? t('choreboard.form.allDay') : formatTime12(choreStore.starts[b]);
}

/**
 * The form as a payload: a pure function of form state (fresh arrays, every field present), so
 * the open-time snapshot and the save-time payload compare field by field (`formDiff`).
 * Weekdays are sorted, so the same days picked in another order are no change.
 */
function buildDraft(): ChoreDraft {
  return {
    title: title.value.trim(),
    emoji: emoji.value,
    illustration: illustration.value || undefined,
    assigneeIds: [...livingPicked.value],
    block: block.value,
    days: daysMode.value === 'every' ? [] : [...days.value].sort((a, b) => a - b),
    notifyParents: notifyParentsShown.value && notifyParents.value,
  };
}

async function handleSave(): Promise<void> {
  const choreId = props.choreId;
  if (isSubmitting.value || !choreId) return;
  const actorId = familyStore.currentMemberId;
  if (!actorId) return;
  const session = generation;
  isSubmitting.value = true;
  try {
    const current = editing.value;
    // Only what the grown-up changed since the form opened, so a concurrent edit on another
    // device keeps every field this form did not touch. A chore gone from under the form still
    // goes to the store, whose `not-found` refusal tells the grown-up; it is never re-created.
    const patch = current ? formDiff.changes(buildDraft()) : buildDraft();
    const saved =
      current && Object.keys(patch).length === 0
        ? current
        : await choreStore.updateChore(choreId, patch, actorId);
    if (session !== generation) return;
    if (!saved) {
      // Refused or failed: the store has already toasted. A refusal for a chore that is gone
      // has nothing left to retry, so close; anything else stays open to retry.
      if (!choreStore.choreById(choreId)) emit('close');
      return;
    }
    emit('saved', saved.id);
    emit('close');
  } finally {
    if (session === generation) isSubmitting.value = false;
  }
}

const nameOf = (id: string) => getMemberById(id)?.name ?? '';

async function handleDelete(): Promise<void> {
  const current = editing.value;
  const actorId = familyStore.currentMemberId;
  if (!current || !actorId || isSubmitting.value) return;
  const people = livingAssignees(current, choreStore.livingIds);
  const names = formatNameList(membersByIds(familyStore.members, people).map((m) => m.name));
  const shared = people.length > 1;
  const bean = props.beanId && people.includes(props.beanId) ? props.beanId : null;

  let scope: 'all' | 'bean' | null;
  if (shared && bean) {
    const choice = await confirmChoice({
      title: 'choreboard.form.deleteConfirm.title',
      message: 'choreboard.form.deleteConfirm.sharedMessage',
      variant: 'danger',
      choices: [
        {
          id: 'bean',
          label: fillTemplate(t('choreboard.form.deleteConfirm.onlyFor'), {
            name: firstName(nameOf(bean)),
          }),
        },
        {
          id: 'all',
          label: fillTemplate(t('choreboard.form.deleteConfirm.forEveryone'), { names }),
        },
      ],
      defaultChoice: 'bean',
    });
    scope = choice === 'bean' || choice === 'all' ? choice : null;
  } else {
    const ok = await confirm({
      title: 'choreboard.form.deleteConfirm.title',
      message: 'choreboard.form.deleteConfirm.message',
      detail: shared ? fillTemplate(t('choreboard.form.deleteConfirm.who'), { names }) : undefined,
      variant: 'danger',
    });
    scope = ok ? 'all' : null;
  }
  if (!scope) return;
  const done =
    scope === 'bean' && bean
      ? await choreStore.removeChoresForMember([current.id], bean, actorId)
      : await choreStore.deleteChore(current.id, actorId);
  // null: already toasted by the store.
  if (!done) return;
  playWhoosh();
  emit('deleted');
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('choreboard.form.titleEdit')"
    icon="✏️"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="t('choreboard.form.saveEdit')"
    :save-ready="v.canSave.value"
    :is-submitting="isSubmitting"
    :show-delete="true"
    @close="emit('close')"
    @save="v.attemptSave(handleSave)"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('choreboard.form.name')" v-bind="v.bind('title')">
      <div class="flex items-stretch gap-2">
        <span
          class="dark:border-line-strong dark:bg-surface-overlay flex w-12 flex-none items-center justify-center overflow-hidden rounded-xl border border-[var(--tint-slate-10)] bg-white text-2xl"
          aria-hidden="true"
          data-testid="chore-form-preview"
        >
          <CardArt
            :card="{ emoji, illustration: choreArtSrc(illustration || undefined) }"
            img-class="h-full w-full object-contain"
          />
        </span>
        <BaseInput
          v-model="title"
          class="min-w-0 flex-1"
          :placeholder="t('choreboard.form.namePlaceholder')"
          :maxlength="CHORE_TITLE_MAX"
          data-testid="chore-form-title"
        />
      </div>
    </FormFieldGroup>

    <FormFieldGroup :label="t('choreboard.form.who')" v-bind="v.bind('who')">
      <ListPeoplePicker v-model="assigneeIds" hint-testid="chore-form-who-refused">
        <template #hint>
          <p
            v-if="livingPicked.length > 1"
            class="dark:text-ink-faint text-secondary-400 mt-1.5 text-xs"
            data-testid="chore-form-shared-hint"
          >
            {{ t('choreboard.form.whoShared') }}
          </p>
        </template>
      </ListPeoplePicker>
    </FormFieldGroup>

    <FormFieldGroup :label="t('choreboard.form.block')">
      <div
        class="grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        data-testid="chore-form-blocks"
      >
        <button
          v-for="b in CHORE_BLOCKS"
          :key="b"
          type="button"
          class="font-outfit flex flex-col items-center rounded-2xl border-2 bg-[var(--chore-tint)] px-1 py-2 text-sm font-bold text-[var(--chore-ink)] transition-all duration-150"
          :class="[
            CHORE_BLOCK_META[b].colorClass,
            block === b
              ? 'border-primary-500 shadow-[0_6px_16px_rgba(241,93,34,0.18)]'
              : 'border-transparent',
          ]"
          :aria-pressed="block === b ? 'true' : 'false'"
          :data-block="b"
          @click="block = b"
        >
          <span class="text-2xl leading-tight" aria-hidden="true">{{
            CHORE_BLOCK_META[b].emoji
          }}</span>
          {{ t(CHORE_BLOCK_META[b].labelKey) }}
          <span class="font-inter text-xs font-medium">{{ blockTime(b) }}</span>
        </button>
      </div>
    </FormFieldGroup>

    <FormFieldGroup :label="t('choreboard.form.days')" v-bind="v.bind('days')">
      <div class="flex flex-wrap gap-2" data-testid="chore-form-days-modes">
        <ChipButton
          v-for="m in DAYS_MODES"
          :key="m.value"
          :label="t(m.labelKey)"
          :selected="daysMode === m.value"
          :pressed="daysMode === m.value"
          :data-mode="m.value"
          @click="pickDaysMode(m.value)"
        />
      </div>
      <div v-if="daysMode !== 'every'" class="mt-3" data-testid="chore-form-days">
        <DayOfWeekSelector :model-value="days" accent="orange" @update:model-value="onDaysPicked" />
      </div>
    </FormFieldGroup>

    <NotifyParentsToggle
      v-if="notifyParentsShown"
      v-model="notifyParents"
      testid="chore-form-notify-parents"
    />

    <!-- The picture: decorative, so last and folded away. The preview by the name shows it. -->
    <div data-testid="chore-form-picture">
      <button
        type="button"
        class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
        :aria-expanded="pictureOpen ? 'true' : 'false'"
        data-testid="chore-form-picture-toggle"
        @click="pictureOpen = !pictureOpen"
      >
        {{ t('choreboard.form.changePicture') }}
        <svg
          class="h-4 w-4 flex-none transition-transform duration-200"
          :class="pictureOpen ? 'rotate-90' : ''"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06L8.26 14.8a.75.75 0 0 1-1.06 0Z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
      <div v-if="pictureOpen" class="mt-3">
        <ChorePicturePicker v-model:emoji="emoji" v-model:illustration="illustration" />
      </div>
    </div>
  </BeanieFormModal>
</template>
