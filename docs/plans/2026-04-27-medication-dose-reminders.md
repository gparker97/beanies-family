# Plan: Medication dose reminders in Family Nook critical briefing

> Date: 2026-04-27
> Goal: surface "give this medication today" reminders in `useCriticalItems` so families don't miss doses; redesign frequency capture so reminders are computable.

---

## Context

The medications system tracks active/inactive medications per family member with timestamped log entries. `medicationsStore.dosesToday(medicationId)` already returns today's local-time count of log entries. What's missing:

1. **No structured "doses per day"** — `Medication.frequency` is free-text ("3x daily", "every 4 hours"), unparseable for "how many doses still need to be given today".
2. **No reminder surface** — `useCriticalItems` shows todos and activities; medications are invisible from the daily briefing.

Outcome: every active medication with a structured `dosesPerDay` appears in the Nook critical briefing as `Don't forget: {name} for {member} ({remaining} more today)` until that day's required doses are logged. Then it disappears, mirroring todo-completion behavior.

---

## Approach

### 1. Data model — add `dosesPerDay`, keep `frequency` for display

`src/types/models.ts`:

```ts
interface Medication {
  // ... existing fields ...
  frequency: string; // unchanged — display string ("twice daily")
  dosesPerDay?: number | null; // NEW: 1-4, or null = "as needed / other"
}
```

Two fields by design:

- `dosesPerDay` — structured, machine-readable, drives reminder math
- `frequency` — display label, auto-generated from `dosesPerDay` when 1-4, free-text when null

**No auto-migration parser.** Legacy meds have `dosesPerDay === undefined` → no reminder fires. Re-edit once to enable.

### 2. Frequency UI — reuse existing `FrequencyChips`

**DRY discovery:** `src/components/ui/FrequencyChips.vue` is already a chip picker used by `TransactionModal`, `EmergencyContactFormModal`, `FamilyMemberModal`. Same brand language (Heritage Orange selected, slate default), same `{ value, label, icon?, disabled?, disabledHint? }` shape. **Reuse directly** — no new component, no slot generalization, family-consistent UX across all forms.

In `MedicationFormModal.vue`, replace the `frequency` `BaseInput` with:

```vue
<FormFieldGroup :label="t('medications.field.dosesPerDay')" required>
  <FrequencyChips v-model="doseChoice" :options="doseOptions" />
</FormFieldGroup>

<!-- Live preview — only when 1-4 selected -->
<p
  v-if="dosesPerDay !== null"
  class="font-outfit text-xs text-[var(--color-text-muted)] italic dark:text-gray-400"
>
  {{ t('medications.willDisplayAs') }} "{{ frequency }}"
</p>

<!-- Free-text reveal when 'other' selected -->
<Transition name="other-reveal">
  <FormFieldGroup
    v-if="doseChoice === 'other'"
    :label="t('medications.frequencyDescribe')"
    required
  >
    <BaseInput v-model="frequency" :placeholder="t('medications.placeholder.frequency')" />
  </FormFieldGroup>
</Transition>
```

`doseChoice` is a string-typed computed-with-setter that bridges the chip's string values (`'1'`, `'2'`, `'3'`, `'4'`, `'other'`) and the model's `dosesPerDay: number | null`:

```ts
const FREQ_DISPLAY: Record<number, () => string> = {
  1: () => t('medications.frequencyAuto.onceDaily'),
  2: () => t('medications.frequencyAuto.twiceDaily'),
  3: () => t('medications.frequencyAuto.threeDaily'),
  4: () => t('medications.frequencyAuto.fourDaily'),
};

const doseOptions = computed<ChipOption[]>(() => [
  { value: '1', label: t('medications.dosesOption.once') },
  { value: '2', label: t('medications.dosesOption.twice') },
  { value: '3', label: t('medications.dosesOption.three') },
  { value: '4', label: t('medications.dosesOption.four') },
  { value: 'other', label: t('medications.dosesOption.other') },
]);

const doseChoice = computed<string>({
  get() {
    if (typeof dosesPerDay.value === 'number' && dosesPerDay.value >= 1 && dosesPerDay.value <= 4) {
      return String(dosesPerDay.value);
    }
    // legacy (undefined) and explicit null both display as 'other'
    return 'other';
  },
  set(v: string) {
    if (v === 'other') {
      dosesPerDay.value = null;
      // Leave existing `frequency` text untouched so user's typed value survives
      return;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      console.warn('[MedicationFormModal] invalid dose choice:', v);
      return;
    }
    dosesPerDay.value = n;
    frequency.value = FREQ_DISPLAY[n]();
  },
});
```

Reveal animation: scoped Vue `<Transition name="other-reveal">` with max-height + opacity (matches the existing pattern in `MedicationFormModal`'s `ongoing` toggle).

### 3. `useCriticalItems` — add medication block

`src/composables/useCriticalItems.ts`:

```ts
export interface CriticalItem {
  id: string;
  type: 'todo' | 'activity' | 'medication'; // ← extended
  // ... existing fields unchanged ...
}
```

New section between activities and todos:

```ts
// ── Active medications with required-but-not-yet-logged doses today ──
for (const med of medicationsStore.medications) {
  // Skip inactive (existing pure helper, takes today as arg)
  if (!isMedicationActive(med, todayStr.value)) continue;
  // Skip "as needed / other" — no count to remind against
  if (typeof med.dosesPerDay !== 'number') continue;
  const remaining = med.dosesPerDay - medicationsStore.dosesToday(med.id);
  if (remaining <= 0) continue; // all doses given today — cleared

  const memberName = getMemberName(med.memberId, '');
  const messageKey: UIStringKey =
    remaining === 1 ? 'nook.criticalMedReminderOne' : 'nook.criticalMedReminder';
  items.push({
    id: med.id,
    type: 'medication',
    message: buildMessage(messageKey, {
      medication: med.name,
      member: memberName,
      remaining: String(remaining),
    }),
    icon: '💊',
    time: '', // untimed in v1
    completable: false, // tap-to-open-detail, no inline +dose
  });
}
```

**Audience:** all family members (the message says "for {member}"; patient sees their own, caretakers see the patient's). No new role gating.

**Sort:** medications go to the bottom alongside untimed items via the existing sort.

**Overflow count:** the `overflowCount` computed needs the same medication block in its tally so the "+N more" badge stays accurate.

### 4. `FamilyStatusToast` click-handler — open MedicationViewModal

The existing `MedicationViewModal.vue` is the detail drawer with the dose log. **Reuse directly** (same pattern as `BeanMedicationsTab.vue:84-114`).

`FamilyStatusToast.vue`:

- Add a `view-medication` emit alongside the existing `view-todo` / `view-activity`
- Item-click dispatcher routes `type === 'medication'` to that emit

`FamilyNookPage.vue` (the toast's parent):

- Add modal state ref: `medicationViewState = ref<{ medicationId: UUID } | null>(null)`
- Listen for `view-medication` from the toast → set the state
- Render `<MedicationViewModal :open="!!medicationViewState" :medication-id="medicationViewState?.medicationId" @close="medicationViewState = null">`

If the medication ID can't be resolved (deleted between render and click), `MedicationViewModal`'s existing reactive resolution handles it gracefully (the modal's existing implementation handles this — verified by reading the file). No extra error handling needed at the click boundary.

### 5. i18n keys (en + beanie, run `npm run translate` after)

```
medications.field.dosesPerDay = "How often each day?"
medications.dosesOption.once   = "Once"
medications.dosesOption.twice  = "Twice"
medications.dosesOption.three  = "3×"
medications.dosesOption.four   = "4×"
medications.dosesOption.other  = "Other / as needed"
medications.frequencyAuto.onceDaily   = "once daily"
medications.frequencyAuto.twiceDaily  = "twice daily"
medications.frequencyAuto.threeDaily  = "3 times daily"
medications.frequencyAuto.fourDaily   = "4 times daily"
medications.willDisplayAs       = "Will display as:"
medications.frequencyDescribe   = "Describe the schedule"

nook.criticalMedReminder    = "Don't forget: {medication} for {member} ({remaining} more today)"
nook.criticalMedReminderOne = "Don't forget: {medication} for {member} (1 more today)"
```

Old keys retained: `medications.field.frequency` and `medications.placeholder.frequency` are still used (in the "Other" reveal).

### 6. Tests

**`src/composables/__tests__/useCriticalItems.test.ts`** — extend with 6 medication scenarios:

- Active med, `dosesPerDay: 2`, 0 logs today → 1 critical item, "(2 more today)"
- Active med, `dosesPerDay: 2`, 1 log today → "(1 more today)" (singular variant key)
- Active med, `dosesPerDay: 2`, 2 logs today → no critical item (cleared)
- Active med, `dosesPerDay: 2`, 3 logs (over-dosed) → no critical item (remaining ≤ 0)
- Active med, `dosesPerDay: undefined` → no critical item (legacy)
- Inactive med (endDate < today), `dosesPerDay: 2` → no critical item

**`src/components/pod/__tests__/MedicationFormModal.test.ts`** — extend (or create) with 4 scenarios:

- Picking '2' chip sets `dosesPerDay = 2` AND auto-fills `frequency = "twice daily"`
- Picking 'other' sets `dosesPerDay = null`; reveals free-text input; existing `frequency` preserved
- Editing legacy med (no `dosesPerDay`) opens with 'other' selected, existing frequency in free-text
- Invalid string passed to setter logs `[MedicationFormModal] invalid dose choice` and does not mutate state

### 7. Failure modes — explicit handling

| Failure mode                                                 | Handling                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Invalid value passed to `doseChoice` setter                  | `console.warn('[MedicationFormModal] invalid dose choice:', v)`, no state mutation                          |
| Translation key missing for `frequencyAuto.X`                | `t()` returns the key as-is — visible to user (not silent), prompting key addition                          |
| `medicationsStore.dosesToday(id)` for unknown id             | Returns 0 (existing behavior — verified in store) — remaining = dosesPerDay, item shows correctly           |
| `getMemberName(deletedMemberId, '')`                         | Returns empty string — message shows "for " (mild but not silent; existing helper behavior, used elsewhere) |
| Click on med critical-item where med was just deleted        | `MedicationViewModal`'s reactive resolver renders empty state (existing behavior, no extra handling needed) |
| Saving the form with `dosesPerDay: null` and empty frequency | Existing `canSave` guard requires `frequency.value.trim().length > 0` — already covered                     |

No silent failures. All paths either succeed cleanly, log to console with `[ModuleName]` prefix, or surface to the existing toast/banner stack.

---

## Files affected

| File                                                       | Change                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/models.ts`                                      | Add `dosesPerDay?: number \| null` to `Medication`                                                                                                                                                          |
| `src/components/pod/MedicationFormModal.vue`               | Replace `BaseInput` for `frequency` with `FrequencyChips` + computed-with-setter `doseChoice`, reveal `BaseInput` only when `'other'` selected, add live preview line, scoped `<Transition>` for the reveal |
| `src/composables/useCriticalItems.ts`                      | Add medication-reminder block; extend `CriticalItem.type` union; update `overflowCount` to include meds                                                                                                     |
| `src/components/nook/FamilyStatusToast.vue`                | Add `view-medication` emit; route `type === 'medication'` clicks to it                                                                                                                                      |
| `src/pages/FamilyNookPage.vue` (toast's parent)            | Add `medicationViewState` ref; render `<MedicationViewModal>` bound to it; listen for `@view-medication`                                                                                                    |
| `src/services/translation/uiStrings.ts`                    | New keys (en + beanie). Run `npm run translate`.                                                                                                                                                            |
| `src/composables/__tests__/useCriticalItems.test.ts`       | 6 new medication scenarios                                                                                                                                                                                  |
| `src/components/pod/__tests__/MedicationFormModal.test.ts` | New (or extended) — 4 chip-selector behavior cases                                                                                                                                                          |
| `docs/plans/2026-04-27-medication-dose-reminders.md`       | This file                                                                                                                                                                                                   |
| `CHANGELOG.md`, `docs/STATUS.md`                           | Updates on ship                                                                                                                                                                                             |

**Existing components/utilities reused (zero new duplicates):**

- `FrequencyChips` — the chip-picker component (3 existing call sites; this is the 4th)
- `MedicationViewModal` — the dose-log detail drawer
- `medicationsStore.dosesToday(id)` — already-tested, local-time-correct
- `isMedicationActive(med, today)` — pure helper, takes today as arg
- `useToday().today` — reactive day source
- `getMemberName()` — existing fallback-handling member name lookup
- `useTranslation` `t()` with placeholder-replacement (`buildMessage`) — already in `useCriticalItems`
- `FormFieldGroup`, `BaseInput`, `BeanieFormModal` — existing modal scaffold

**Bean-dot motif (from `frontend-design` consult):** intentionally deferred. Adopting it would require generalizing `FrequencyChips` with a slot — premature for one use case. If a second tile-style picker emerges, generalize then.

---

## Verification

1. `npm run test -- useCriticalItems MedicationFormModal medicationsStore --run` — green, including all medication scenarios.
2. `npm run type-check && npm run lint` — clean.
3. `npm run translate` — confirm parser still works after the new key block.
4. **Manual E2E:**
   - Edit a med, pick "Twice" → preview line reads `"twice daily"`; save; medication card shows "twice daily" caption.
   - Visit `/nook` → critical briefing shows `Don't forget: <name> for <member> (2 more today)`.
   - Tap the critical-item → `MedicationViewModal` opens with that med + dose log.
   - Log a dose → critical-item updates to `(1 more today)`.
   - Log second dose → critical-item disappears.
   - Edit the med → pick "Other" → free-text reveals with previous text; save; reminder no longer fires.
   - Edit a legacy med (free-text frequency, no `dosesPerDay`) → modal opens on "Other" with existing text; saving as-is keeps it legacy.
5. Brand check: `FrequencyChips` already brand-consistent across 3 forms; medication picker inherits.

---

## Out of scope (deliberate)

- Time-of-day reminders ("morning and at night") — would require a new `dosesAtTimes: string[]` field on Medication. v2.
- Inline "+1 dose" button on the critical-item — opens `MedicationViewModal` for now (which has the dose-log).
- Auto-migration parser for legacy free-text frequencies — fragile, low value (re-edit during normal med refresh).
- Bean-dot motif on the chips — would require generalizing `FrequencyChips` with a slot; premature for one use case.
- Caretaker-role concept (only show meds to non-patient family members) — current "show to all + 'for {member}' in message" is simpler and accurate.
