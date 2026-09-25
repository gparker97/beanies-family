import { computed, nextTick, ref, watch } from 'vue';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { showToast } from '@/composables/useToast';
import { logEvent } from '@/services/telemetry/logEvent';
import { useTranslationStore } from '@/stores/translationStore';
import { fillTemplate } from '@/utils/fillTemplate';

/**
 * Required-field validation for every form drawer: one place that knows what is missing, marks
 * it, and takes the person to it.
 *
 * WHY IT EXISTS. Drawers used to express "a required field is empty" by disabling Save. A
 * disabled button swallows the tap, so the form never learned the person tried: no field was
 * marked, nothing scrolled, nothing said what was missing, and on a phone the empty field was
 * often off-screen. The drawers that kept Save live marked the field, but still could not say
 * where it was. This composable is the one answer: Save stays tappable and looks "not ready"
 * (`BeanieFormModal`'s `saveReady`, bound to `canSave`), and a tap while incomplete marks every
 * missing field, scrolls the first into view, pulses it, and toasts what is still needed.
 *
 * THE DOM CONTRACT. The composable and `FormFieldGroup` meet through exactly two attributes:
 *   - `data-form-field` (`FORM_FIELD_ATTR`): the scroll target, `<formId>:<field>`;
 *   - `data-form-label` (`FORM_LABEL_ATTR`): the field's name as the toast should print it.
 * The label is read from the hooked element ITSELF, never from its descendants. A
 * `FormFieldGroup` supplies its own (its `label` prop); any other target gets it from
 * `hook(field, label)`, and the label must be a noun that names the field. Renaming either side
 * breaks the contract test in `__tests__/useFormValidation.test.ts`.
 *
 * Usage:
 *   const v = useFormValidation('goal', () => ({
 *     name: () => name.value.trim().length > 0,
 *     ...(hasTarget.value ? { target: () => (target.value ?? 0) > 0 } : {}),
 *   }), { open: () => props.open });
 *
 *   <BeanieFormModal :save-ready="v.canSave.value" @save="v.attemptSave(handleSave)">
 *     <FormFieldGroup :label="t('goal.name')" v-bind="v.bind('name')">…</FormFieldGroup>
 */

export const FORM_FIELD_ATTR = 'data-form-field';
export const FORM_LABEL_ATTR = 'data-form-label';

/**
 * Field → predicate returning true when the field holds a valid value.
 *
 * Include a field only while it is RENDERED and required: build the record conditionally
 * (`...(cond ? { field: pred } : {})`). A rule for a field removed by `v-if` is reported at run
 * time as `target_missing`. A field inside a `ConditionalSection` is NOT removed when collapsed
 * (it hides by CSS), so a rule for it must use the section's own `show` expression as its
 * condition, or the scroll lands on an invisible element and nothing can detect it.
 */
export type FormRules<Field extends string> = Partial<Record<Field, () => boolean>>;

export interface FormValidationOptions {
  /** The drawer's open state. Every drawer passes it; `reset()` then runs on each open. */
  open?: () => boolean;
}

/** Per-instance prefix, so stacked drawers never find each other's fields. `useId()` would
 *  return '' outside a component (and in unit tests); a counter works everywhere. */
let instanceCounter = 0;

const SURFACE = 'form-validation';

export function useFormValidation<Field extends string>(
  formName: string,
  rules: () => FormRules<Field>,
  opts: FormValidationOptions = {}
) {
  const formId = `fv${++instanceCounter}`;
  const hasAttemptedSave = ref(false);
  let blockedThisOpen = false;
  const reportedThrows = new Set<string>();

  const current = computed(rules);

  function passes(field: Field, predicate: () => boolean): boolean {
    try {
      return predicate();
    } catch (err) {
      // Fail safe (treat as missing, so the person is told) and never silent. Once per field per
      // instance, because this runs inside a computed that recomputes on every keystroke.
      if (!reportedThrows.has(field)) {
        reportedThrows.add(field);
        console.error(
          `[useFormValidation:${formName}] rule "${field}" threw — fix the rule predicate:`,
          err
        );
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'a validation rule threw; the field is treated as missing',
          context: { action: 'rule_threw', kind: formName, error_code: field },
          error: err,
        });
      }
      return false;
    }
  }

  const missing = computed(() => {
    const out = new Set<Field>();
    for (const [field, predicate] of Object.entries(current.value) as [Field, () => boolean][]) {
      if (predicate && !passes(field, predicate)) out.add(field);
    }
    return out;
  });

  const canSave = computed(() => missing.value.size === 0);

  /** Drives the asterisk: the field is required while it has a rule. */
  function isRequired(field: Field): boolean {
    return !!current.value[field];
  }

  /** Drives the ring: only after a Save has been tried, never on open. */
  function showError(field: Field): boolean {
    return hasAttemptedSave.value && missing.value.has(field);
  }

  /** The scroll hook for a target that is not a `FormFieldGroup` (give it a noun label). */
  function hook(field: Field, label?: string): Record<string, string> {
    return {
      [FORM_FIELD_ATTR]: `${formId}:${field}`,
      ...(label ? { [FORM_LABEL_ATTR]: label } : {}),
    };
  }

  /**
   * Everything a `FormFieldGroup` needs: `v-bind="v.bind('name')"`. Pass `label` only when the
   * group's own label is not a noun (e.g. a question): it overrides the toast label, because
   * fallthrough attributes win over the root's own `data-form-label`.
   */
  function bind(field: Field, label?: string) {
    const error = showError(field);
    return {
      ...hook(field, label),
      required: isRequired(field),
      error,
      errorMessage: error ? useTranslationStore().t('validation.required') : undefined,
    };
  }

  /**
   * Mark, find and name what is missing. The ONLY code here that touches the DOM, the toast or
   * telemetry, and it runs only on an invalid attempt.
   */
  async function revealMissing(): Promise<void> {
    await nextTick();
    const prefix = `${formId}:`;
    const hooked = [...document.querySelectorAll<HTMLElement>(`[${FORM_FIELD_ATTR}^="${prefix}"]`)];
    const found = hooked.filter((el) =>
      missing.value.has(el.getAttribute(FORM_FIELD_ATTR)!.slice(prefix.length) as Field)
    );
    const foundFields = new Set(found.map((el) => el.getAttribute(FORM_FIELD_ATTR)));

    for (const field of missing.value) {
      if (foundFields.has(`${prefix}${field}`)) continue;
      console.warn(
        `[useFormValidation:${formName}] "${field}" is missing but has no ${FORM_FIELD_ATTR} ` +
          `hook — add v-bind="v.bind('${field}')" (or v.hook) to its element, or drop the rule ` +
          `while the field is not rendered.`
      );
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'a missing field has no scroll target',
        context: { action: 'target_missing', kind: formName, error_code: field },
      });
    }

    useAttentionPulse().reveal(found[0]);
    // The field the person was actually sent to (DOM order); rule order only when none was hooked.
    const firstShown = found[0]?.getAttribute(FORM_FIELD_ATTR)?.slice(prefix.length);

    const { t } = useTranslationStore();
    const labels = [
      ...new Set(found.map((el) => el.getAttribute(FORM_LABEL_ATTR)).filter(Boolean)),
    ] as string[];
    showToast(
      'info',
      t('form.missing.title'),
      labels.length
        ? fillTemplate(t('form.missing.message'), { fields: labels.join(', ') })
        : undefined
    );

    blockedThisOpen = true;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'save blocked by missing fields',
      context: {
        action: 'blocked',
        kind: formName,
        error_code: firstShown ?? [...missing.value][0],
      },
    });
  }

  /**
   * Wrap the drawer's save. Marks missing fields, then runs `onValid` only when nothing is
   * missing. Errors thrown by `onValid` propagate to the drawer's own handling.
   *
   * THE SAVE BUTTON MUST NOT BE DISABLED ON `!canSave`.
   *
   * The travel drawers once bound `:save-disabled="!canSave"`, which made this whole mechanism
   * unreachable: with a field missing the click never fired, so nothing was ever marked. What
   * people met: an AI-extracted hotel comes back booked with no address (confirmation emails
   * often omit it), and Save is permanently greyed out with no ring, no message and no way to
   * learn that the address is the blocker. Bind `:save-ready="v.canSave.value"` instead: the
   * button looks not-ready and still reaches this function.
   */
  async function attemptSave<T>(onValid: () => T | Promise<T>): Promise<T | undefined> {
    hasAttemptedSave.value = true;
    if (!canSave.value) {
      await revealMissing();
      return undefined;
    }
    // The success-path signal, on EVERY valid attempt, so the blocked rate per form has a
    // denominator (CLAUDE.md observability rule 6): `recovered` after a block this open, else
    // `passed`.
    // A step with no rules (a wizard's later steps) validated nothing, so it is not counted.
    if (Object.keys(current.value).length > 0)
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: blockedThisOpen
          ? 'save passed validation after a block'
          : 'save passed validation first time',
        context: { action: blockedThisOpen ? 'recovered' : 'passed', kind: formName },
      });
    blockedThisOpen = false;
    return await onValid();
  }

  /** Quiet again: no rings until the next Save. Runs on every open when `open` is given. */
  function reset(): void {
    hasAttemptedSave.value = false;
    blockedThisOpen = false;
  }

  if (opts.open) {
    watch(opts.open, (isOpen) => {
      if (isOpen) reset();
    });
  }

  return {
    missing,
    canSave,
    hasAttemptedSave,
    isRequired,
    showError,
    bind,
    hook,
    attemptSave,
    reset,
  };
}

export type FormValidation<Field extends string> = ReturnType<typeof useFormValidation<Field>>;
