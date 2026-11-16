<script setup lang="ts">
/**
 * Stars and rewards (#148): give a kid bonus stars, or take some away. The app's right-hand
 * drawer (`BeanieFormModal variant="drawer"`, as the chore editors are), opened from the "Give
 * Stars" buttons on the Rewards and Star Report views (no one picked) and on a kid's day (that
 * kid picked).
 *
 *  - Who: the kids (`starStore.earnerMembers`), one at a time.
 *  - Give Bonus / Take Away. Take Away is always open to a grown-up (greg, 2026-11-16: no family
 *    setting). It is Heritage Orange like everything else here, never red.
 *  - How many (`NumberStepper`, 1 to `STAR_GIFT_MAX`; a take-away is capped at the kid's stars
 *    this week, and the line beside the stepper says so).
 *  - The note: optional for a bonus, a short reason required for a take-away (`STAR_NOTE_MAX`).
 *  - "{name} will see": the exact note the kid will read (`StarNote`).
 *
 * Validation is the one rule `giftRefusal` (`utils/choreStars.ts`), the same the store applies, so
 * the form and the store cannot disagree; the required reason also goes through
 * `useFormValidation` (Save stays tappable and rings the field). The modal closes only on a
 * non-null store result: a `null` has already been toasted and logged by the store, so nothing
 * here toasts, and the input stays as typed.
 *
 * MUST stay mounted while closed (`useFormModal` seeds on the open transition).
 *
 * Dark mode: the drawer's raised panel, body and inputs come from `BeanieFormModal` / `BaseInput`; the kid chips
 * from `FamilyChipPicker`; the toggle is `TogglePillGroup` (orange). Text `secondary-*` / `ink*`;
 * the "nothing to take away" line is `primary-700` / `accent-lift` (never red).
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import StarNote from '@/components/chores/StarNote.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useFormValidation } from '@/composables/useFormValidation';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useStarStore } from '@/stores/starStore';
import { STAR_GIFT_MAX, STAR_NOTE_MAX } from '@/constants/choreStars';
import { giftRefusal, type GiftInput } from '@/utils/choreStars';
import { firstName } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  open: boolean;
  /** The kid to pick on open (opened from their day), or `null` for the first kid. */
  memberId: string | null;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const starStore = useStarStore();

/** The kids who earn stars, in family order. */
const kids = computed<FamilyMember[]>(() => starStore.earnerMembers);

const who = ref('');
const kind = ref<GiftInput['kind']>('bonus');
const count = ref<number | undefined>(1);
const note = ref('');

function reset(): void {
  const preset = props.memberId && kids.value.some((k) => k.id === props.memberId);
  who.value = preset ? props.memberId! : (kids.value[0]?.id ?? '');
  kind.value = 'bonus';
  count.value = 1;
  note.value = '';
}

const { isSubmitting } = useFormModal(
  () => null,
  () => props.open,
  { onEdit: reset, onNew: reset }
);

function pickWho(value: string | string[]): void {
  const id = Array.isArray(value) ? value[0] : value;
  if (id && kids.value.some((k) => k.id === id)) who.value = id;
}

const isTake = computed(() => kind.value === 'take');
const kid = computed(() => kids.value.find((k) => k.id === who.value) ?? null);
const kidName = computed(() => (kid.value ? firstName(kid.value.name) : ''));
const week = computed(() => (who.value ? starStore.weekFor(who.value) : null));
const weekTotal = computed(() => week.value?.total ?? 0);

/** A take-away cannot take more than the kid has this week (the stepper's top). */
const countMax = computed(() =>
  isTake.value ? Math.max(1, Math.min(STAR_GIFT_MAX, weekTotal.value)) : STAR_GIFT_MAX
);
// A smaller cap (another kid picked, Take Away chosen) pulls the count down to it.
watch(countMax, (max) => {
  if (count.value !== undefined && count.value > max) count.value = max;
});
/** Nothing to take away: the action is genuinely unavailable for this kid this week. */
const nothingToTake = computed(() => isTake.value && weekTotal.value <= 0);

const kindOptions = computed(() => [
  { value: 'bonus', label: t('choreStars.bonus.tab'), variant: 'orange' as const },
  { value: 'take', label: t('choreStars.takeBack.tab'), variant: 'orange' as const },
]);
function setKind(value: string): void {
  if (value !== 'bonus' && value !== 'take') return;
  kind.value = value;
}

const input = computed<GiftInput>(() => ({
  kind: kind.value,
  count: count.value ?? 0,
  note: note.value,
}));
const refusal = computed(() => giftRefusal(input.value, week.value, starStore.rewards));

const v = useFormValidation(
  'star-gift',
  () => ({
    ...(isTake.value ? { note: () => note.value.trim().length > 0 } : {}),
  }),
  { open: () => props.open }
);

/** Shown under "How many" once a save was tried and the rule refuses the count. */
const countError = computed(() => {
  if (!v.hasAttemptedSave.value) return '';
  if (refusal.value === 'invalid') return t('choreStars.gift.countInvalid');
  if (refusal.value === 'over-week') {
    return fillTemplate(t('choreStars.error.overWeek'), {
      name: kidName.value,
      count: weekTotal.value,
    });
  }
  return '';
});

const countHint = computed(() => {
  const n = count.value ?? 0;
  if (!isTake.value) return t(n === 1 ? 'choreStars.gift.unit.one' : 'choreStars.gift.unit.other');
  return fillTemplate(
    t(weekTotal.value === 1 ? 'choreStars.takeBack.most.one' : 'choreStars.takeBack.most.other'),
    { name: kidName.value, count: weekTotal.value }
  );
});

const title = computed(() =>
  t(isTake.value ? 'choreStars.takeBack.title' : 'choreStars.bonus.title')
);
const saveLabel = computed(() => {
  const n = count.value ?? 0;
  const key: UIStringKey = isTake.value
    ? n === 1
      ? 'choreStars.takeBack.save.one'
      : 'choreStars.takeBack.save.other'
    : n === 1
      ? 'choreStars.bonus.save.one'
      : 'choreStars.bonus.save.other';
  return fillTemplate(t(key), { count: n });
});

/** The note as the kid will read it, signed by the grown-up giving it. */
const preview = computed(() => ({
  stars: (isTake.value ? -1 : 1) * Math.max(1, count.value ?? 1),
  note: note.value,
}));
const meName = computed(() =>
  familyStore.currentMember ? firstName(familyStore.currentMember.name) : ''
);

async function onSave(): Promise<void> {
  if (isSubmitting.value || !kid.value || nothingToTake.value) return;
  // The same rule the store applies; the inline lines above say which part to change.
  if (refusal.value) return;
  const actorId = familyStore.currentMemberId;
  if (!actorId) return;
  isSubmitting.value = true;
  try {
    const gift = await starStore.giveStars(
      {
        memberId: kid.value.id,
        kind: kind.value,
        count: count.value ?? 0,
        note: note.value.trim() || undefined,
      },
      actorId
    );
    // null: the store has already toasted and logged it; keep the form as typed.
    if (gift) emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

const labelClass =
  'font-outfit text-secondary-500 dark:text-ink-soft text-xs font-semibold tracking-[0.08em] uppercase';
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="title"
    :icon="isTake ? '↩' : '🌟'"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="saveLabel"
    :save-ready="v.canSave.value && !refusal"
    :save-disabled="!kid || nothingToTake"
    :is-submitting="isSubmitting"
    save-testid="star-gift-save"
    @close="emit('close')"
    @save="v.attemptSave(onSave)"
  >
    <div class="space-y-5" data-testid="star-gift-modal">
      <p v-if="!kids.length" class="text-secondary-500 dark:text-ink-soft text-sm">
        {{ t('choreStars.worth.noKids') }}
      </p>

      <template v-else>
        <FormFieldGroup :label="t('choreStars.gift.who')">
          <FamilyChipPicker
            :model-value="who"
            mode="single"
            :members="kids"
            @update:model-value="pickWho"
          />
        </FormFieldGroup>

        <div data-testid="star-gift-kind">
          <TogglePillGroup
            :model-value="kind"
            :options="kindOptions"
            :aria-label="t('choreStars.gift.kindLabel')"
            @update:model-value="setKind"
          />
        </div>

        <FormFieldGroup
          :label="t('choreStars.gift.howMany')"
          :error="!!countError"
          :error-message="countError"
        >
          <p
            v-if="nothingToTake"
            class="text-primary-700 dark:text-accent-lift text-sm font-semibold"
            data-testid="star-gift-none"
          >
            {{ fillTemplate(t('choreStars.takeBack.none'), { name: kidName }) }}
          </p>
          <div v-else class="flex flex-wrap items-center gap-3">
            <NumberStepper
              v-model="count"
              :min="1"
              :max="countMax"
              :label="t('choreStars.gift.howMany')"
              data-testid="star-gift-count"
            />
            <span
              class="text-secondary-500 dark:text-ink-soft min-w-0 flex-1 text-sm"
              data-testid="star-gift-count-hint"
              >{{ countHint }}</span
            >
          </div>
        </FormFieldGroup>

        <FormFieldGroup
          v-if="isTake"
          :label="t('choreStars.takeBack.reason')"
          v-bind="v.bind('note')"
          :error-message="v.showError('note') ? t('choreStars.error.noteRequired') : undefined"
        >
          <BaseInput
            v-model="note"
            :maxlength="STAR_NOTE_MAX"
            :placeholder="t('choreStars.takeBack.reasonPlaceholder')"
            data-testid="star-gift-note"
          />
          <p class="text-secondary-400 dark:text-ink-faint mt-1.5 text-xs">
            {{ fillTemplate(t('choreStars.takeBack.reasonHint'), { name: kidName }) }}
          </p>
        </FormFieldGroup>
        <FormFieldGroup v-else :label="t('choreStars.bonus.whatFor')">
          <BaseInput
            v-model="note"
            :maxlength="STAR_NOTE_MAX"
            :placeholder="t('choreStars.bonus.whatForPlaceholder')"
            data-testid="star-gift-note"
          />
        </FormFieldGroup>

        <div v-if="kid && !nothingToTake" class="space-y-2" data-testid="star-gift-preview">
          <span :class="labelClass">{{
            fillTemplate(t('choreStars.gift.willSee'), { name: kidName })
          }}</span>
          <StarNote :gift="preview" :by-name="meName" />
        </div>
      </template>
    </div>
  </BeanieFormModal>
</template>
