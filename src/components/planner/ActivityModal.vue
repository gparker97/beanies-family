<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import RecurrencePicker from '@/components/ui/RecurrencePicker.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import AssigneePickerButton from '@/components/ui/AssigneePickerButton.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ActivityCategoryPicker from '@/components/ui/ActivityCategoryPicker.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import RecurringPaymentPrompt from '@/components/ui/RecurringPaymentPrompt.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import PhotoAttachments from '@/components/media/PhotoAttachments.vue';
import TripShortcutCard from '@/components/planner/TripShortcutCard.vue';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { calculateMonthlyFee } from '@/utils/finance';
import { resolveActivityRule, activityShadowFromRule } from '@/services/recurrence/adapters';
import { monthlyFactor, occurrenceCount } from '@/services/recurrence/recurrenceEngine';
import { diffPayload } from '@/utils/diffPayload';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useActivityStore } from '@/stores/activityStore';
import { usePhotoStore } from '@/stores/photoStore';
import { useTranslation } from '@/composables/useTranslation';
import { useMagicReader } from '@/composables/useMagicReader';
import { useFormModal } from '@/composables/useFormModal';
import { useEagerEntityCreate } from '@/composables/useEagerEntityCreate';
import { usePhotoEntityBinding } from '@/composables/usePhotoEntityBinding';
import { getActivityCategoryColor, getActivityFallbackEmoji } from '@/constants/activityCategories';
import {
  addHourToTime,
  formatNookDate,
  extractDatePart,
  parseLocalDate,
  toDateInputValue,
  addDays,
} from '@/utils/date';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
import { ensureHttpUrl } from '@/utils/url';
import type {
  FamilyActivity,
  ActivityCategory,
  FeeSchedule,
  ReminderMinutes,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
} from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';
import type { FieldConfidence } from '@/services/ai/types';
import {
  ACTIVITY_LEAD_OPTIONS,
  ACTIVITY_LEAD_CHIP_KEYS,
  toActivityLeadOption,
} from '@/utils/reminderSchedule';

const props = defineProps<{
  open: boolean;
  activity?: FamilyActivity | null;
  defaultDate?: string;
  defaultStartTime?: string;
  defaultAssigneeIds?: string[];
  /**
   * Full field prefill for a NEW activity (e.g. extracted from a photo/invitation — #133).
   * Applied inside `onNew` after the base defaults; purely additive and non-breaking.
   */
  prefill?: Partial<CreateFamilyActivityInput>;
  /** Per-field confidence accompanying `prefill`; low-confidence fields are flagged for review. */
  prefillConfidence?: FieldConfidence;
  /**
   * The source document image (#133) to attach to the activity once the eager-create gate is
   * satisfiable. Attached via the existing PhotoAttachments / photo-upload path; the user can
   * remove it before saving like any other photo.
   */
  sourcePhoto?: File;
  readOnly?: boolean;
  occurrenceDate?: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }];
  delete: [];
  'start-vacation-wizard': [defaults: { assigneeIds: string[]; date: string }];
  /** "Perform magic" — page closes this modal, runs the photo reader, reopens pre-filled. */
  'start-photo-reader': [];
}>();

const { t } = useTranslation();
// Gates the "Perform magic" half of the Quick-start row (photo reader, #133).
const { canReadPhoto } = useMagicReader();

/** "Plan a trip" — hand off to the vacation wizard and close this modal. */
function startTripWizard(): void {
  emit('start-vacation-wizard', { assigneeIds: [...assigneeIds.value], date: date.value });
  emit('close');
}
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const activityStore = useActivityStore();
const photoStore = usePhotoStore();

// Form state
const icon = ref('');
const title = ref('');
const description = ref('');
const date = ref('');
const endDate = ref('');
const isAllDay = ref(false);
const startTime = ref('');
const endTime = ref('');
/**
 * Recurrence is carried by exactly TWO pieces of state (#70):
 *
 *  - `mode` — the one bit a `RecurrenceRule` cannot express: does this recur at
 *    all? Driven by the one-time/recurring cards at the top of the modal.
 *  - `rule` — the canonical cadence, owned entirely by `RecurrencePicker`.
 *
 * The legacy `recurrence`/`daysOfWeek`/`recurrenceEndDate` enum trio is NOT
 * kept alongside them: two independently-mutable representations of the same
 * cadence is the desync class docs/lessons.md warns about. The legacy shadow is
 * derived once, at the payload boundary, in `buildPayload`.
 */
const mode = ref<'one-off' | 'recurring'>('recurring');
const rule = ref<RecurrenceRule | null>(null);
const isRecurring = computed(() => mode.value === 'recurring');
const category = ref<ActivityCategory>('' as ActivityCategory);
const assigneeIds = ref<string[]>([]);
const dropoffMemberId = ref<string>('');
const pickupMemberId = ref<string>('');
const location = ref('');
const feeSchedule = ref<FeeSchedule>('none');
const feeAmount = ref<number | undefined>(undefined);
const feeCurrency = ref('');
const feeCustomPeriod = ref<number | undefined>(undefined);
const feeCustomPeriodUnit = ref<'weeks' | 'months'>('weeks');
const createRecurringPayment = ref(false);
const feePayFromAccountId = ref('');
const instructorName = ref('');
const instructorContact = ref('');
// Defaults to the device's configured activity lead (Settings → Reminders),
// NOT 0. `0` is the chip's "None" and now genuinely suppresses the OS reminder,
// so defaulting to it would mean every newly created activity silently never
// reminds.
// No cast: settingsStore.activityReminderLead is already narrowed to a valid
// ReminderMinutes at the getter (the single read site every consumer uses).
const reminderMinutes = ref<ReminderMinutes>(settingsStore.activityReminderLead);
const notes = ref('');
const link = ref('');
const isActive = ref(true);
const color = ref('');
const showMoreDetails = ref(false);
const showErrors = ref(false);

// --- Document-extraction prefill (#133) ---
// Below this per-field confidence we visually flag the field for the user to double-check.
const LOW_CONFIDENCE_THRESHOLD = 0.5;
// True only when the current NEW form was opened with an extraction prefill — gates the
// low-confidence hints so a normal manual "add" never shows them.
const wasPrefilled = ref(false);
// The #133 source document staged for attach (set in onNew; attached once the gate clears).
const pendingSourcePhoto = ref<File | null>(null);
// Local object-URL preview of the staged source photo, shown in the photos section the moment
// the AI draft opens — BEFORE the activity is eager-created (the real Drive upload still happens
// via maybeAttachSourcePhoto once the gate clears). Lifecycle is explicit so the object URL is
// always revoked (no leak): replaced on re-stage, dropped once the real photo binds (entityId
// set) or the modal closes, and on unmount.
const sourcePhotoPreviewUrl = ref<string | null>(null);
function setSourcePhotoPreview(file: File | null): void {
  if (sourcePhotoPreviewUrl.value) URL.revokeObjectURL(sourcePhotoPreviewUrl.value);
  sourcePhotoPreviewUrl.value = file ? URL.createObjectURL(file) : null;
}

/** Apply an optional extraction prefill over the just-set onNew defaults (additive). */
function applyPrefill(): void {
  wasPrefilled.value = false;
  const p = props.prefill;
  if (!p) return;
  wasPrefilled.value = true;
  // Photo-extracted events default to one-time, overriding onNew's 'weekly' (an invitation
  // is almost always a single occurrence). Forward-compatible: honours an explicit recurrence
  // if a prefill ever carries one (e.g. a detected repeating event).
  // A photo-extracted event is almost always a single occurrence; honour an
  // explicit recurrence if a prefill ever carries one.
  mode.value = (p.recurrence ?? 'none') === 'none' ? 'one-off' : 'recurring';
  if (p.recurrence && p.recurrence !== 'none') {
    rule.value =
      resolveActivityRule({
        recurrence: p.recurrence,
        date: p.date ?? date.value,
        daysOfWeek: p.daysOfWeek,
        recurrenceEndDate: p.recurrenceEndDate,
      })?.rule ?? null;
  }
  if (p.title !== undefined) title.value = p.title;
  if (p.date) date.value = p.date;
  if (p.location !== undefined) location.value = p.location;
  if (p.description !== undefined) description.value = p.description;
  // AI-extracted prep notes route to the VISIBLE `notes` field, which lives inside the
  // collapsed "Add more details" section — reveal it so the prefilled notes aren't hidden
  // (onNew sets showMoreDetails=false before this runs; only `notes` is prefilled today).
  if (p.notes !== undefined) {
    notes.value = p.notes;
    showMoreDetails.value = true;
  }
  if (p.isAllDay !== undefined) isAllDay.value = p.isAllDay;
  if (p.startTime) startTime.value = p.startTime;
  if (p.endTime) endTime.value = p.endTime;
  // Inferred category (when matched) — the category watch derives the icon + colour.
  if (p.category) category.value = p.category;
}

const titleLowConfidence = computed(
  () =>
    wasPrefilled.value &&
    !!props.prefillConfidence &&
    props.prefillConfidence.title < LOW_CONFIDENCE_THRESHOLD &&
    !!title.value.trim()
);

// Auto-labelled frequency chips shown inside the Schedule section when
// `recurrence !== 'none'`. The 'none' / one-off option is handled by the
// mode-toggle CARDS at the top of the modal (not by the chip row), so the
// chips here only enumerate the 4 recurring kinds.
//
// Labels are derived live from the activity's current `date` — so changing
// the start date updates "Monthly on the 14th" → "Monthly on the 15th"
// without an extra round-trip.
//
// Multi-day weekly (e.g. Mon + Wed + Fri) is weekly-only by design: biweekly
// anchors to a single weekday and monthly variants anchor to a single date.
// When the user has picked >1 day, the non-weekly chips are disabled with a
// hint explaining why — keeps them discoverable rather than silently hiding,
// and prevents silently losing extra day-of-week selections on a chip swap.
// (#70) The chip option list and its "multi-day is weekly-only" disabled-hint
// are gone: `RecurrencePicker`'s model makes that state unrepresentable
// (multiple weekdays exist only for interval 1), so there is nothing to warn
// about and no chip to disable.

/**
 * The top-of-modal cards split "one-time" vs "recurring" — the first-order
 * decision. Toggling only flips `mode`; `rule` is left untouched, so a
 * recurring → one-time → recurring round-trip restores the user's WHOLE
 * schedule (interval, weekdays, end), not just the coarse frequency kind the
 * old `lastRecurringKind` remembered.
 */
function setRecurrenceMode(next: 'recurring' | 'one-off'): void {
  mode.value = next === 'one-off' ? 'one-off' : 'recurring';
}

// Check if any "more details" field has data (for auto-expand in edit mode)
function hasDetailData(activity: FamilyActivity): boolean {
  return !!(
    activity.notes ||
    activity.link ||
    activity.instructorName ||
    activity.instructorContact ||
    (activity.feeAmount && activity.feeAmount > 0) ||
    // NOTE: `reminderMinutes` is deliberately absent — the reminder field was
    // promoted out of this collapsible, so it can no longer be a reason to
    // auto-expand it (and with a non-zero default it would expand on nearly
    // every activity).
    !activity.isActive
  );
}

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.activity,
  () => props.open,
  {
    onEdit: (activity) => {
      icon.value = activity.icon ?? '';
      title.value = activity.title;
      description.value = activity.description ?? '';
      // Seed from the OCCURRENCE being edited, not the series start. The banner
      // above the form already shows `occurrenceDate`; seeding `activity.date`
      // here made the form display two different dates, and — because
      // `buildPayload` emits `date` unconditionally — silently moved the
      // occurrence to the series start on a "just this item" save. See
      // docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md.
      //
      // RECURRING ONLY. `occurrenceDate` is also supplied for a NON-recurring
      // multi-day all-day activity (every day of its range is a clickable
      // occurrence), where `date` is the range START. Seeding the clicked day
      // there would show the wrong start date and let a one-day nudge truncate
      // the trip — there is no scope modal on a one-off to catch it.
      date.value =
        activity.recurrence !== 'none' ? (props.occurrenceDate ?? activity.date) : activity.date;
      endDate.value = activity.endDate ?? '';
      isAllDay.value = activity.isAllDay ?? false;
      startTime.value = activity.startTime ?? '';
      endTime.value = activity.endTime ?? '';
      mode.value = activity.recurrence === 'none' ? 'one-off' : 'recurring';
      // The SERIES start, which for a recurring activity differs from `date`
      // (seeded from the opened occurrence).
      seriesAnchor.value = extractDatePart(activity.date);
      // Resolve through the shared adapter: `rule` when the series has one,
      // else derived from the legacy fields. An untouched form therefore emits
      // no `rule` at all (the diff below sees no change), so a legacy series
      // stays on the legacy expansion path until deliberately edited.
      rule.value = resolveActivityRule(activity)?.rule ?? null;
      category.value = activity.category;
      assigneeIds.value = normalizeAssignees(activity);
      dropoffMemberId.value = activity.dropoffMemberId ?? '';
      pickupMemberId.value = activity.pickupMemberId ?? '';
      location.value = activity.location ?? '';
      feeSchedule.value = activity.feeSchedule === 'none' ? 'per_session' : activity.feeSchedule;
      feeAmount.value = activity.feeAmount ?? 0;
      feeCurrency.value = activity.feeCurrency ?? settingsStore.displayCurrency;
      createRecurringPayment.value = !!activity.linkedRecurringItemId;
      feePayFromAccountId.value = activity.payFromAccountId ?? '';
      feeCustomPeriod.value = activity.feeCustomPeriod;
      feeCustomPeriodUnit.value = activity.feeCustomPeriodUnit ?? 'weeks';
      instructorName.value = activity.instructorName ?? '';
      instructorContact.value = activity.instructorContact ?? '';
      reminderMinutes.value = activity.reminderMinutes;
      notes.value = activity.notes ?? '';
      link.value = activity.link ?? '';
      isActive.value = activity.isActive;
      color.value = activity.color ?? getActivityCategoryColor(activity.category);
      showMoreDetails.value = hasDetailData(activity);
      showErrors.value = false;
      wasPrefilled.value = false; // editing an existing activity is never a prefill
      // Usually null, but the AI "update existing" flow opens an existing activity in edit mode
      // WITH a source document to attach — stage it symmetrically with onNew so it binds to this
      // activity. Manual edits never set props.sourcePhoto (the page clears it), so this is null.
      pendingSourcePhoto.value = props.sourcePhoto ?? null;
      setSourcePhotoPreview(props.sourcePhoto ?? null);
    },
    onNew: () => {
      icon.value = '';
      title.value = '';
      description.value = '';
      date.value = props.defaultDate ?? todayStr();
      endDate.value = '';
      isAllDay.value = false;
      startTime.value = props.defaultStartTime ?? '09:00';
      endTime.value = addHourToTime(startTime.value);
      mode.value = 'recurring';
      rule.value = null;
      seriesAnchor.value = date.value;
      category.value = '' as ActivityCategory;
      assigneeIds.value = props.defaultAssigneeIds ?? [];
      dropoffMemberId.value = '';
      pickupMemberId.value = '';
      location.value = '';
      feeSchedule.value = 'per_session';
      feeAmount.value = 0;
      feeCurrency.value = settingsStore.displayCurrency;
      createRecurringPayment.value = false;
      feePayFromAccountId.value = '';
      feeCustomPeriod.value = undefined;
      feeCustomPeriodUnit.value = 'weeks';
      instructorName.value = '';
      instructorContact.value = '';
      reminderMinutes.value = settingsStore.activityReminderLead;
      notes.value = '';
      link.value = '';
      isActive.value = true;
      color.value = '';
      showMoreDetails.value = false;
      showErrors.value = false;
      // Apply an extraction prefill, if any, over the defaults just set above.
      applyPrefill();
      // Stage the source document; maybeAttachSourcePhoto() attaches it once the gate clears.
      // Show it as a local preview immediately so the user sees it on the fresh AI draft.
      pendingSourcePhoto.value = props.sourcePhoto ?? null;
      setSourcePhotoPreview(props.sourcePhoto ?? null);
    },
  }
);

// When category changes, auto-set icon and color
watch(category, (newCategory) => {
  if (!newCategory) return;
  icon.value = getActivityFallbackEmoji(newCategory);
  color.value = getActivityCategoryColor(newCategory);
});

// NOTE (#70): the weekday re-anchor watcher that lived here is GONE.
// `RecurrencePicker` now owns re-anchoring — it re-derives an untouched weekday
// set (and the monthly day) when its `start-date` changes, using the same
// "untouched" heuristic. Keeping a second copy here is exactly how two
// re-anchor rules drift apart. `suppressDaysOfWeekSync` went with it: it was a
// modal-local flag and could never have suppressed a watcher inside the picker
// anyway — the fix is that the picker is anchored on the SERIES start date
// (`seriesAnchor`), not the occurrence-seeded `date`, so populating an edit
// cannot re-anchor anything.

// Sync endTime when startTime changes (skip during edit population)
let suppressEndTimeSync = false;

/**
 * Baseline snapshot of the form payload, taken once per open in edit mode.
 *
 * `handleSave` diffs against this so the emitted update contains ONLY what the
 * user actually changed. Diffing against `props.activity` instead would couple
 * correctness to `buildPayload`'s derivations (`payFromAccountId: ''`,
 * `feeSchedule: 'none'`, the legacy `assigneeId` mirror) staying in lockstep
 * with the stored shape forever — and, since `date` is now seeded from
 * `occurrenceDate`, would emit `date` on every recurring occurrence edit.
 *
 * `null` when there is nothing to diff against (a create, including the
 * eager-create path where the entity exists but `onEdit` never ran). The rule
 * is one line: no baseline → no diff → emit the full payload.
 *
 * ALSO null for the AI "update existing activity" flow. There, the page passes
 * an in-memory object merged from the extraction that was NEVER PERSISTED, so
 * the extracted fields are already in the baseline — the user reviews, changes
 * nothing, saves, the diff comes back empty and every extracted field is
 * silently discarded. `props.sourcePhoto` is the flow's marker (set by
 * `applyUpdateExisting`), and a full payload is what that flow wants anyway.
 */
const editBaseline = ref<CreateFamilyActivityInput | null>(null);
watch(
  () => props.open,
  (open) => {
    if (open && props.activity) {
      // Suppress the startTime watcher during edit population. Vue's default
      // 'pre' watchers are queued, not synchronous: onEdit's field assignments
      // queue those callbacks, and this watcher — registered later on the same
      // `props.open` source — sets the flag before the queue flushes.
      // (#70: the daysOfWeek flag is gone with the watcher it guarded.)
      suppressEndTimeSync = true;
      nextTick(() => {
        suppressEndTimeSync = false;
        // Taken AFTER the flags release so watcher-settled values are part of
        // the baseline rather than surfacing as phantom user changes.
        // Skipped for the AI update-existing flow — see the ref's docblock.
        editBaseline.value = props.sourcePhoto ? null : buildPayload();
      });
    } else {
      editBaseline.value = null;
    }
  }
);
watch(startTime, (newStart) => {
  if (suppressEndTimeSync || !newStart) return;
  endTime.value = addHourToTime(newStart);
});
// Clamp endTime to not be before startTime
watch(endTime, (newEnd) => {
  if (!newEnd || !startTime.value) return;
  if (newEnd < startTime.value) {
    endTime.value = startTime.value;
  }
});

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The date the recurrence rule is anchored to.
 *
 * CRITICAL (#70): this is the SERIES start, not `date`. For a recurring
 * activity `date` is deliberately seeded from `props.occurrenceDate` (see the
 * 2026-08-15 occurrence-edit work), so binding the picker to it would anchor
 * the rule on whichever occurrence the user opened — e.g. opening the February
 * occurrence of a clamped "31st" series would re-derive `monthlyDay = 28` and
 * permanently reschedule the whole series on save.
 */
const seriesAnchor = ref('');

/**
 * Keep the series anchor in step with the user's date edits.
 *
 * `props.activity.date` alone is a CONSTANT while the modal is open, so binding
 * the picker to it makes the picker's own re-anchor watcher unreachable in edit
 * mode — and this modal's date watcher was removed on the grounds that the
 * picker had taken that job over. Instead the anchor moves by the same DELTA the
 * user applied to `date`, which is exactly what `useActivityScopeEdit.shiftAnchor`
 * does to the stored template on save. The two therefore agree.
 */
watch(date, (newDate, oldDate) => {
  if (!newDate || !seriesAnchor.value) return;
  if (!oldDate) return;
  const deltaDays = Math.round(
    (parseLocalDate(newDate).getTime() - parseLocalDate(oldDate).getTime()) / 86_400_000
  );
  if (deltaDays === 0) return;
  seriesAnchor.value = toDateInputValue(addDays(parseLocalDate(seriesAnchor.value), deltaDays));
});

/**
 * "All sessions" pricing needs a finite session count, which exists only when
 * the series actually ends — by date OR after a set number of times (#70; the
 * latter is newly expressible via the picker).
 */
const allScheduleEnabled = computed(
  () => isRecurring.value && !!rule.value && rule.value.end.kind !== 'never'
);

const feeScheduleChipOptions = computed(() => {
  const allChip = {
    value: 'all',
    label: t('planner.fee.all'),
    ...(allScheduleEnabled.value
      ? {}
      : { disabled: true, disabledHint: t('planner.fee.allDisabledHint') }),
  };
  // Order: Per Session, All Sessions, then periodic options
  const periodic: FeeSchedule[] = ['weekly', 'monthly', 'yearly', 'custom'];
  return [
    { value: 'per_session', label: t('planner.fee.per_session') },
    allChip,
    ...periodic.map((f) => ({ value: f, label: t(`planner.fee.${f}` as const) })),
  ];
});

// Reset feeSchedule away from 'all' if end date is cleared
watch(
  () => allScheduleEnabled.value,
  (enabled) => {
    if (!enabled && feeSchedule.value === 'all') {
      feeSchedule.value = 'per_session';
    }
  }
);

// Generated from the shared option list, so the chips and the Settings default
// select can never offer different values (they used to: LEAD_OPTIONS carried
// 120/180, which the chips could not render and 180 isn't even a ReminderMinutes).
const reminderChipOptions = computed(() =>
  ACTIVITY_LEAD_OPTIONS.map((m) => ({ value: String(m), label: t(ACTIVITY_LEAD_CHIP_KEYS[m]) }))
);

const hasCost = computed(() => (feeAmount.value ?? 0) > 0);

const isAllSchedule = computed(() => feeSchedule.value === 'all');

const calculatedMonthly = computed(() => {
  if (!hasCost.value || feeSchedule.value === 'none' || isAllSchedule.value) return 0;
  if (!isRecurring.value || !rule.value) return 0; // one-time — no monthly equivalent
  return calculateMonthlyFee({
    feeSchedule: feeSchedule.value,
    feeAmount: feeAmount.value ?? 0,
    // The REAL occurrence rate, straight off the canonical rule — not "sessions
    // per week", which was only ever correct for weekly activities (#70).
    monthlyOccurrences: monthlyFactor(rule.value),
    feeCustomPeriod: feeCustomPeriod.value,
    feeCustomPeriodUnit: feeCustomPeriodUnit.value,
  });
});

/**
 * Session count for the "all sessions" fee breakdown.
 *
 * (#70) Was a hand-rolled walk that only handled `weekly` — daily, biweekly and
 * yearly all fell into a MONTHS count, so a daily class was priced per month.
 * Now the engine counts, which also means a count-bounded (`afterCount`) series
 * works, which the old `recurrenceEndDate`-based version could not express.
 * `occurrenceCount` returns null for an unbounded or uncountable series; 0 here
 * makes `perSessionCost` return 0 rather than dividing by a wrong number.
 */
const totalSessions = computed(() => {
  if (!isAllSchedule.value || !rule.value) return 0;
  return occurrenceCount(rule.value, seriesAnchor.value) ?? 0;
});

const perSessionCost = computed(() => {
  if (!isAllSchedule.value || !hasCost.value || totalSessions.value <= 0) return 0;
  return Math.round((Math.abs(feeAmount.value ?? 0) / totalSessions.value) * 100) / 100;
});

const canSave = computed(() => {
  if (!title.value.trim() || !date.value) return false;
  if (assigneeIds.value.length === 0) return false;
  if (hasCost.value && feeSchedule.value === 'none') return false;
  if (
    hasCost.value &&
    feeSchedule.value === 'custom' &&
    (!feeCustomPeriod.value || feeCustomPeriod.value <= 0)
  )
    return false;
  return true;
});

// Per-field error flags (only visible after attempted save)
const errorAssignees = computed(() => showErrors.value && assigneeIds.value.length === 0);
const errorTitle = computed(() => showErrors.value && !title.value.trim());
const errorDate = computed(() => showErrors.value && !date.value);

const modalTitle = computed(() =>
  isEditing.value ? t('planner.editActivity') : t('planner.newActivity')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveActivity') : t('modal.addActivity')
);

/**
 * Build the activity payload from current form state. Used by both
 * the eager-create path (photos require an entity id before save) and
 * the final emit('save') handler. Includes `photoIds` from the binding
 * composable so eager-uploaded photos persist on first save.
 */
function buildPayload(): CreateFamilyActivityInput {
  const currentMember = familyStore.currentMember ?? familyStore.owner;
  const assigneePayload = toAssigneePayload(assigneeIds.value);

  return {
    title: title.value.trim(),
    icon: icon.value || undefined,
    description: description.value.trim() || undefined,
    date: date.value,
    endDate: isAllDay.value && endDate.value ? endDate.value : undefined,
    isAllDay: isAllDay.value || undefined,
    startTime: isAllDay.value ? undefined : startTime.value || undefined,
    endTime: isAllDay.value ? undefined : endTime.value || undefined,
    // #70: the canonical rule is authoritative; the legacy enum trio is derived
    // HERE and nowhere else, so the two can never drift. A one-time activity
    // carries no rule at all.
    rule: isRecurring.value && rule.value ? rule.value : undefined,
    ...(isRecurring.value && rule.value
      ? activityShadowFromRule(rule.value)
      : { recurrence: 'none' as const, daysOfWeek: undefined, recurrenceEndDate: undefined }),
    category: category.value,
    ...assigneePayload,
    dropoffMemberId: dropoffMemberId.value || undefined,
    pickupMemberId: pickupMemberId.value || undefined,
    location: location.value.trim() || undefined,
    feeSchedule: hasCost.value ? feeSchedule.value : ('none' as FeeSchedule),
    feeAmount: hasCost.value ? feeAmount.value : undefined,
    feeCurrency: hasCost.value ? feeCurrency.value : undefined,
    ...(hasCost.value && feeSchedule.value === 'custom' && feeCustomPeriod.value
      ? { feeCustomPeriod: feeCustomPeriod.value, feeCustomPeriodUnit: feeCustomPeriodUnit.value }
      : {}),
    ...(hasCost.value && createRecurringPayment.value && feePayFromAccountId.value
      ? { payFromAccountId: feePayFromAccountId.value }
      : { payFromAccountId: '' }),
    instructorName: instructorName.value.trim() || undefined,
    instructorContact: instructorContact.value.trim() || undefined,
    reminderMinutes: reminderMinutes.value,
    notes: notes.value.trim() || undefined,
    link: link.value.trim() || undefined,
    ...(binding.photoIds.value.length ? { photoIds: [...binding.photoIds.value] } : {}),
    isActive: isActive.value,
    color: color.value || undefined,
    createdBy: currentMember?.id ?? '',
  };
}

/**
 * Eager-create + photo-binding wiring.
 *
 * Eager-create gates on the same `canSave` predicate as the final Save
 * (title + date + at least one assignee). The "Add photos" placeholder
 * stays disabled until those minimums are met so the user can't end up
 * with an orphan, ill-formed activity record.
 *
 * The composable's `commit()` is intentionally NOT used here — the
 * parent `FamilyPlannerPage` owns the create-vs-update branching for
 * the final Save (recurring-occurrence scoped save, "Activity Created"
 * confirmation, fee-cascade to recurring transactions). We only use
 * `ensureId()` to mint the entity on first photo tap; the final Save
 * path is unchanged below — it just emits, with `eager.entityId`
 * choosing the update vs create emit shape.
 */
const photoAttachmentsRef = ref<{
  openPicker: () => void;
  addFiles: (files: File[]) => Promise<unknown>;
} | null>(null);

/**
 * Reactive gate predicate. Same fields as `canSave` — keeps the photo
 * placeholder's disabled state and the inline hint visibility in lock-
 * step with the form-level Save button.
 */
const firstMissingFieldKey = computed<string | null>(() => {
  if (!title.value.trim()) return 'title';
  if (!date.value) return 'date';
  if (assigneeIds.value.length === 0) return 'assignees';
  return null;
});

const addPhotosHint = computed(() =>
  firstMissingFieldKey.value !== null ? t('activities.photoGate.fillFirst') : null
);

const eager = useEagerEntityCreate<FamilyActivity, CreateFamilyActivityInput>({
  resolveExistingId: () => props.activity?.id ?? null,
  firstMissingField: () => firstMissingFieldKey.value,
  buildPayload,
  create: (payload) => activityStore.createActivity(payload),
  update: (id, payload) => activityStore.updateActivity(id, payload),
});

const binding = usePhotoEntityBinding({
  entityId: eager.entityId,
  // Read photoIds from the live Automerge doc rather than the prop snapshot.
  // The parent (FamilyPlannerPage) captures `editingActivity.value = target`
  // at click-time — a plain object reference that doesn't reactively update
  // when the doc changes. Reading via `photoStore.photoIdsFor` subscribes
  // to docVersion so background uploads (e.g. one that completes after the
  // user closes the drawer) get picked up on reopen via the deep watch
  // inside the binding. See `photoIdsFor`'s JSDoc for the full chain.
  initialPhotoIds: () => photoStore.photoIdsFor('activities', eager.entityId.value),
  watchSource: () => props.activity?.id,
  update: (id, patch) => activityStore.updateActivity(id, patch),
  surface: 'ActivityModal',
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !props.activity) eager.reset();
    if (!isOpen) setSourcePhotoPreview(null); // revoke the staged-photo object URL on close
  }
);

// Once the activity is eager-created the real PhotoAttachments tile takes over, so drop the
// local preview (and revoke its object URL). onBeforeUnmount is the final safety net.
watch(
  () => eager.entityId.value,
  (id) => {
    if (id) setSourcePhotoPreview(null);
  }
);
onBeforeUnmount(() => setSourcePhotoPreview(null));

async function handleAddFirstPhoto(): Promise<void> {
  const id = await eager.ensureId();
  if (!id) return;
  await nextTick();
  photoAttachmentsRef.value?.openPicker();
}

// --- Source-photo attach (#133) ---
// The photo picked for AI extraction is attached to the activity once the eager-create gate
// is satisfiable (title + date + assignee). We attach via the SAME PhotoAttachments instance
// the user would use manually (its `addFiles`), so all compression/upload/queue/error/toast
// handling is inherited. Driven by an explicit trigger — NOT coupled to the validation
// predicate's field list — with a synchronous clear-before-await one-shot guard.
// (`pendingSourcePhoto` is declared near the top — useFormModal's onNew sets it.)
async function maybeAttachSourcePhoto(): Promise<void> {
  const photo = pendingSourcePhoto.value;
  if (!photo || firstMissingFieldKey.value !== null) return;
  pendingSourcePhoto.value = null; // clear FIRST → never double-attaches on re-trigger
  const id = await eager.ensureId();
  if (!id) {
    pendingSourcePhoto.value = photo; // gate raced shut mid-create; retry when it reopens
    return;
  }
  await nextTick(); // PhotoAttachments mounts (v-if entityId) now that the id exists
  await photoAttachmentsRef.value?.addFiles([photo]);
}

// Fire when a staged photo first becomes attachable. Only deps: the staged photo + the gate.
watch(
  () => pendingSourcePhoto.value !== null && firstMissingFieldKey.value === null,
  (attachable) => {
    if (attachable) void maybeAttachSourcePhoto();
  },
  { immediate: true }
);

function handleSave() {
  if (!canSave.value) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;

  const payload = buildPayload();
  const existingId = eager.entityId.value;

  if (existingId) {
    // Edit-mode OR we eager-created the activity to attach a photo.
    // Either way, the entity already exists — emit as an update so the
    // parent's update path (scoped save for recurring, fee cascade)
    // runs normally. This skips the "Activity Created" confirmation
    // even on the eager-created path; the user already has visible
    // feedback (the photo tile they attached) so the modal is fine.
    //
    // Diff against the baseline so untouched fields never reach the update —
    // an untouched `date` must be ABSENT, otherwise a "just this item" save
    // reschedules the occurrence the user never moved. No baseline (the
    // eager-create path) → emit the full payload, exactly as before.
    //
    // Known, accepted imprecision: `photoIds` arrive asynchronously from the
    // binding composable, so a photo landing after the baseline shows up in the
    // diff at its correct current value — a harmless same-value write. Do not
    // add machinery to chase it.
    const data = editBaseline.value ? diffPayload(editBaseline.value, payload) : payload;
    // `createdBy` is destructured off the DIFF, not the payload — otherwise it
    // rides along into an update whenever the current member changed mid-session.
    const { createdBy: _omit, ...updateData } = data;
    void _omit;
    // Nothing changed — close without a pointless write (and without the
    // recurring scope modal, which would ask the user to scope a no-op).
    if (editBaseline.value && Object.keys(updateData).length === 0) {
      emit('close');
      return;
    }
    emit('save', { id: existingId, data: updateData as UpdateFamilyActivityInput });
  } else {
    emit('save', payload);
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    size="wide"
    :open="open"
    :title="modalTitle"
    :icon="icon || '📋'"
    icon-bg="var(--tint-orange-8)"
    :save-label="readOnly ? t('action.close') : saveLabel"
    :save-disabled="false"
    :is-submitting="isSubmitting"
    :show-delete="isEditing && !readOnly"
    @close="emit('close')"
    @save="readOnly ? emit('close') : handleSave()"
    @delete="emit('delete')"
  >
    <div class="space-y-5" :class="readOnly ? 'pointer-events-none opacity-60' : ''">
      <!-- Occurrence date banner for recurring activity edits -->
      <div
        v-if="occurrenceDate"
        class="mb-4 rounded-[14px] bg-[var(--tint-silk-20)] px-4 py-3 dark:bg-sky-900/20"
      >
        <div class="flex items-center gap-2">
          <span class="text-base">📅</span>
          <span
            class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
          >
            {{ t('planner.editingOccurrence').replace('{date}', formatNookDate(occurrenceDate)) }}
          </span>
        </div>
      </div>

      <!-- Vacation toggle bar -->
      <!-- Quick start: alternative ways to begin a NEW activity. When the photo
           reader is available (flag + permission), "Perform magic" pairs with the
           trip shortcut in a two-up row under a kicker; otherwise the trip
           shortcut shows full-width exactly as before. -->
      <template v-if="!isEditing">
        <!-- Magic available → kicker + two-up row -->
        <div v-if="canReadPhoto">
          <div
            class="font-outfit mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-[var(--color-text-muted)] uppercase opacity-60"
          >
            <span aria-hidden="true">✨</span>{{ t('ai.magic.quickStart') }}
          </div>
          <div class="grid grid-cols-2 gap-3">
            <!-- Perform magic (photo reader) -->
            <button
              type="button"
              class="magic-shimmer from-primary-500 to-terracotta-400 flex cursor-pointer flex-col gap-1 rounded-2xl bg-gradient-to-br p-3 text-left text-white shadow-[0_8px_18px_-8px_rgba(241,93,34,0.6)]"
              @click="emit('start-photo-reader')"
            >
              <span aria-hidden="true" class="text-lg leading-none">✨</span>
              <span class="font-outfit text-sm font-extrabold">{{ t('ai.magic.perform') }}</span>
              <span class="relative z-[1] text-xs leading-snug opacity-90">
                {{ t('ai.magic.performHint') }}
              </span>
            </button>
            <!-- Plan a trip (existing shortcut), compact for the two-up grid -->
            <TripShortcutCard compact @start="startTripWizard" />
          </div>
        </div>

        <!-- Magic off → the original full-width trip shortcut, unchanged -->
        <TripShortcutCard v-else @start="startTripWizard" />
      </template>

      <!-- 1. Schedule mode tab bar (recurring / one-time) — the first-order
           decision. Frequency chips (weekly / biweekly / monthly variants)
           live inside the Schedule field group below, only visible when
           recurring is selected. -->
      <div class="rounded-2xl bg-[var(--tint-slate-5)] p-1.5 dark:bg-slate-700/50">
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="opt in [
              {
                value: 'recurring',
                icon: '🔁',
                label: t('vacation.scheduleRecurring'),
                desc: t('vacation.scheduleRecurringDesc'),
              },
              {
                value: 'one-off',
                icon: '📌',
                label: t('vacation.scheduleOneTime'),
                desc: t('vacation.scheduleOneTimeDesc'),
              },
            ]"
            :key="opt.value"
            type="button"
            class="relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 transition-all duration-200"
            :class="
              (opt.value === 'recurring' ? isRecurring : !isRecurring)
                ? 'border-primary-500 border-2 bg-white shadow-sm dark:bg-slate-600'
                : 'border-2 border-transparent hover:bg-white/60 dark:hover:bg-slate-600/40'
            "
            @click="setRecurrenceMode(opt.value as 'recurring' | 'one-off')"
          >
            <span class="text-lg leading-none">{{ opt.icon }}</span>
            <span
              class="font-outfit text-xs font-bold"
              :class="
                (opt.value === 'recurring' ? isRecurring : !isRecurring)
                  ? 'text-[var(--color-text)] dark:text-gray-100'
                  : 'text-[var(--color-text)] opacity-35 dark:text-gray-400'
              "
            >
              {{ opt.label }}
            </span>
            <span
              class="text-[0.625rem]"
              :class="
                (opt.value === 'recurring' ? isRecurring : !isRecurring)
                  ? 'text-[var(--color-text-muted)]'
                  : 'opacity-25 dark:text-gray-500'
              "
            >
              {{ opt.desc }}
            </span>
            <span
              v-if="opt.value === 'recurring' ? isRecurring : !isRecurring"
              class="bg-primary-500 absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
            />
          </button>
        </div>
      </div>

      <!-- 2. Activity title -->
      <FormFieldGroup :label="t('modal.whatsTheActivity')" required :error="errorTitle">
        <div
          class="focus-within:border-primary-500 rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] dark:bg-slate-700"
        >
          <input
            v-model="title"
            type="text"
            class="font-outfit w-full border-none bg-transparent text-xl font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
            :placeholder="t('modal.whatsTheActivity')"
          />
        </div>
        <!-- Heritage Orange (never Alert Red) review hint for a low-confidence extracted value -->
        <p v-if="titleLowConfidence" class="font-outfit text-primary-500 mt-1.5 text-xs">
          {{ t('ai.lowConfidence.hint') }}
        </p>
      </FormFieldGroup>

      <!-- 3. Schedule — the one shared recurrence control (#70). Same look and
           behaviour as money and lists: simple cadences one tap, "every N"
           behind Custom, context-sensitive sub-controls, and the ends selector
           (never / on a date / after N times). Anchored on the SERIES start
           date, never the opened occurrence. -->
      <template v-if="isRecurring">
        <FormFieldGroup :label="t('modal.schedule')">
          <RecurrencePicker v-model="rule" :start-date="seriesAnchor" />
        </FormFieldGroup>
      </template>

      <!-- 4. All-day toggle -->
      <FormFieldGroup :label="t('planner.allDay')">
        <label class="inline-flex cursor-pointer items-center gap-2.5">
          <input
            v-model="isAllDay"
            type="checkbox"
            class="text-primary-500 focus:ring-primary-500/30 h-5 w-5 rounded-lg border-gray-300 transition dark:border-slate-600 dark:bg-slate-700"
          />
          <span class="text-sm text-[var(--color-text-muted)]">
            {{ t('planner.allDayHint') }}
          </span>
        </label>
      </FormFieldGroup>

      <!-- 5. Date + Times -->
      <!-- Recurring: Start Date / End Date row, then Start Time / End Time row -->
      <template v-if="isRecurring">
        <!-- (#70) The recurrence end moved into RecurrencePicker's "ends"
             control, so this row is a single full-width start date rather than
             a half-empty two-column grid. -->
        <FormFieldGroup :label="t('planner.field.date')" required :error="errorDate">
          <BeanieDatePicker v-model="date" required />
        </FormFieldGroup>
        <div v-if="!isAllDay" class="grid grid-cols-2 gap-4">
          <FormFieldGroup :label="t('modal.startTime')">
            <TimePresetPicker v-model="startTime" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('modal.endTime')">
            <TimePresetPicker v-model="endTime" />
          </FormFieldGroup>
        </div>
      </template>
      <!-- One-off: Date (+ optional end date if all-day), or Date + times -->
      <template v-else>
        <div v-if="isAllDay" class="grid grid-cols-2 gap-4">
          <FormFieldGroup :label="t('planner.field.dateOnly')" required :error="errorDate">
            <BeanieDatePicker v-model="date" required />
          </FormFieldGroup>
          <FormFieldGroup :label="t('planner.field.endDate')" optional>
            <BeanieDatePicker v-model="endDate" :min="date" />
          </FormFieldGroup>
        </div>
        <div v-else class="space-y-3">
          <FormFieldGroup :label="t('planner.field.dateOnly')" required :error="errorDate">
            <BeanieDatePicker v-model="date" required />
          </FormFieldGroup>
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('modal.startTime')">
              <TimePresetPicker v-model="startTime" />
            </FormFieldGroup>
            <FormFieldGroup :label="t('modal.endTime')">
              <TimePresetPicker v-model="endTime" />
            </FormFieldGroup>
          </div>
        </div>
      </template>

      <!-- 6. Who? -->
      <FormFieldGroup :label="t('modal.whosGoing')" required :error="errorAssignees">
        <FamilyChipPicker v-model="assigneeIds" mode="multi" include-pets />
      </FormFieldGroup>

      <!-- 7. Category picker -->
      <FormFieldGroup :label="t('modal.selectCategory')">
        <ActivityCategoryPicker v-model="category" />
      </FormFieldGroup>

      <!-- 8. Location -->
      <FormFieldGroup :label="t('planner.field.location')" optional>
        <BaseInput v-model="location" :placeholder="t('planner.field.location')" />
      </FormFieldGroup>

      <!-- 8. Drop Off Duty / Pick Up Duty -->
      <div class="grid grid-cols-2 gap-4">
        <FormFieldGroup :label="t('planner.field.dropoff')" optional>
          <AssigneePickerButton v-model="dropoffMemberId" mode="single" size="sm" align="left" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('planner.field.pickup')" optional>
          <AssigneePickerButton v-model="pickupMemberId" mode="single" size="sm" align="right" />
        </FormFieldGroup>
      </div>

      <!-- 9. Cost + Fee Schedule -->
      <FormFieldGroup
        :label="
          !isRecurring
            ? t('planner.fee.totalCost')
            : isAllSchedule
              ? t('planner.fee.totalCost')
              : t('modal.costPerSession')
        "
      >
        <CurrencyAmountInput
          v-model:amount="feeAmount"
          v-model:currency="feeCurrency"
          font-size="1.1rem"
        />
      </FormFieldGroup>
      <!-- Fee schedule chips (recurring only — one-off activities just have a flat cost) -->
      <template v-if="isRecurring">
        <FormFieldGroup :label="t('planner.field.feeSchedule')">
          <template #label-extra>
            <InfoHintBadge
              :text="t('planner.fee.scheduleHintIntro')"
              :items="[
                t('planner.fee.scheduleHintPerSession'),
                t('planner.fee.scheduleHintAll'),
                t('planner.fee.scheduleHintWeekly'),
                t('planner.fee.scheduleHintMonthly'),
                t('planner.fee.scheduleHintYearly'),
                t('planner.fee.scheduleHintCustom'),
              ]"
            />
          </template>
          <FrequencyChips v-model="feeSchedule" :options="feeScheduleChipOptions" />
        </FormFieldGroup>

        <!-- Custom period inputs -->
        <div v-if="feeSchedule === 'custom'" class="flex items-center gap-2">
          <span class="font-outfit text-xs font-semibold text-[var(--color-text)]">{{
            t('planner.fee.customPeriod')
          }}</span>
          <BaseInput v-model.number="feeCustomPeriod" type="number" min="1" class="w-20" />
          <TogglePillGroup
            v-model="feeCustomPeriodUnit"
            :options="[
              { value: 'weeks', label: t('planner.fee.weeks') },
              { value: 'months', label: t('planner.fee.months') },
            ]"
          />
        </div>

        <!-- Per-session breakdown for 'all' schedule -->
        <div v-if="isAllSchedule && hasCost && totalSessions > 0" class="flex items-center gap-2">
          <span
            class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
          >
            {{ t('planner.fee.perSessionBreakdown') }}
          </span>
          <span class="font-outfit text-sm font-bold text-[var(--color-text)]">
            {{ formatCurrencyWithCode(perSessionCost, (feeCurrency || 'USD') as any) }}
            <span class="font-normal opacity-50">
              {{ t('planner.fee.sessionsCount').replace('{count}', String(totalSessions)) }}
            </span>
          </span>
        </div>

        <!-- Calculated monthly display (non-all schedules) -->
        <div
          v-if="
            !isAllSchedule &&
            hasCost &&
            feeSchedule !== 'none' &&
            feeSchedule !== 'monthly' &&
            calculatedMonthly > 0
          "
          class="flex items-center gap-2"
        >
          <span
            class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
          >
            {{ t('planner.fee.calculatedMonthly') }}
          </span>
          <span class="font-outfit text-sm font-bold text-[var(--color-text)]">
            {{ formatCurrencyWithCode(calculatedMonthly, (feeCurrency || 'USD') as any)
            }}{{ t('planner.unit.perMonthAbbrev') }}
          </span>
          <InfoHintBadge :text="t('planner.fee.monthlyCalcHint')" />
        </div>
      </template>

      <!-- Linked payment prompt -->
      <RecurringPaymentPrompt
        v-if="hasCost && (isRecurring ? feeSchedule !== 'none' : true)"
        v-model="createRecurringPayment"
        :pay-from-account-id="feePayFromAccountId"
        :payment-amount="
          !isRecurring ? (feeAmount ?? 0) : isAllSchedule ? (feeAmount ?? 0) : calculatedMonthly
        "
        :currency="feeCurrency || 'USD'"
        :start-date="date"
        :frequency="!isRecurring || isAllSchedule ? 'one-time' : 'monthly'"
        @update:pay-from-account-id="feePayFromAccountId = $event"
      />

      <!-- Photos — birthday invites, items-to-bring screenshots, location maps,
           anything visual the user wants pinned to this activity. Eager-creates
           the activity on first photo tap once the gate (title + date + at least
           one assignee) is met; otherwise the placeholder button stays disabled
           and the inline hint names the missing field. -->
      <FormFieldGroup :label="t('photos.label')" optional>
        <PhotoAttachments
          v-if="eager.entityId.value"
          ref="photoAttachmentsRef"
          collection="activities"
          :entity-id="eager.entityId.value"
          :photo-ids="binding.photoIds.value"
          :max="4"
          @update:photo-ids="binding.updatePhotoIds"
        />
        <!-- #133: the AI source photo, shown as a local preview before the activity is created.
             It uploads to Drive + becomes a real attachment once the activity is created. -->
        <div
          v-else-if="sourcePhotoPreviewUrl"
          class="flex items-center gap-3 rounded-2xl border border-[var(--tint-slate-10)] bg-[var(--tint-orange-4)] p-3"
        >
          <img
            :src="sourcePhotoPreviewUrl"
            :alt="t('ai.sourcePhotoPreviewAlt')"
            class="h-16 w-16 flex-shrink-0 rounded-xl object-cover"
          />
          <span class="font-outfit text-xs font-semibold text-[var(--color-text-muted)]">
            📸 {{ t('ai.sourcePhotoPreview') }}
          </span>
        </div>
        <button
          v-else
          type="button"
          :disabled="firstMissingFieldKey !== null || eager.isCreating.value"
          class="hover:border-primary-500 hover:text-primary-500 flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40"
          @click="handleAddFirstPhoto"
        >
          <span class="text-2xl" aria-hidden="true">📷</span>
          <span class="font-outfit text-xs font-semibold">{{ t('activities.addPhotos') }}</span>
        </button>
        <p
          v-if="addPhotosHint"
          class="font-outfit mt-1 text-[0.6875rem] text-[var(--color-text-muted)] italic dark:text-gray-400"
        >
          {{ addPhotosHint }}
        </p>
      </FormFieldGroup>

      <!-- 10. Reminder — a primary field, not an "advanced" one. Promoted out of
           the collapsible once reminders became real OS notifications: it is
           now the control that decides whether the user's phone actually buzzes
           before this activity, so burying it behind a disclosure would hide
           the feature from most people. Sits directly above "more details". -->
      <FormFieldGroup :label="t('planner.field.reminder')">
        <FrequencyChips
          :model-value="String(reminderMinutes)"
          :options="reminderChipOptions"
          @update:model-value="reminderMinutes = toActivityLeadOption(Number($event))"
        />
      </FormFieldGroup>

      <!-- 11. "Add more details" collapsible -->
      <div>
        <button
          type="button"
          class="font-outfit text-primary-500 text-sm font-semibold transition-colors hover:underline"
          @click="showMoreDetails = !showMoreDetails"
        >
          {{ t('planner.field.moreDetails') }}
          <span
            class="ml-1 inline-block transition-transform"
            :class="{ 'rotate-180': showMoreDetails }"
            >&#9662;</span
          >
        </button>

        <div v-if="showMoreDetails" class="mt-3 space-y-4">
          <!-- Instructor -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormFieldGroup :label="t('planner.field.instructor')" optional>
              <BaseInput v-model="instructorName" :placeholder="t('planner.field.instructor')" />
            </FormFieldGroup>
            <FormFieldGroup :label="t('planner.field.instructorContact')" optional>
              <BaseInput
                v-model="instructorContact"
                :placeholder="t('planner.field.instructorContact')"
              />
            </FormFieldGroup>
          </div>

          <!-- Notes -->
          <FormFieldGroup :label="t('planner.field.notes')" optional>
            <textarea
              v-model="notes"
              rows="2"
              class="focus:border-primary-500 w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-base text-[var(--color-text)] transition-all focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
              :placeholder="t('planner.field.notes')"
            />
          </FormFieldGroup>

          <!-- Link -->
          <FormFieldGroup :label="t('planner.field.link')" optional>
            <div class="flex items-center gap-2">
              <BaseInput v-model="link" type="url" placeholder="https://..." class="flex-1" />
              <a
                v-if="link"
                :href="ensureHttpUrl(link)"
                target="_blank"
                rel="noopener noreferrer"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tint-slate-5)] text-sm transition-colors hover:bg-[var(--tint-slate-10)] dark:bg-slate-700"
                :title="t('action.visitLink')"
                >🔗</a
              >
            </div>
          </FormFieldGroup>

          <!-- Active toggle -->
          <div
            class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
          >
            <span
              class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-200"
            >
              {{ t('planner.field.active') }}
            </span>
            <ToggleSwitch v-model="isActive" size="sm" />
          </div>
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
