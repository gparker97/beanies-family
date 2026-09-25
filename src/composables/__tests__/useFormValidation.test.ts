/**
 * The shared "Save tells you what is missing" behaviour for every form drawer.
 *
 * The one thing this file most needs to protect: an invalid Save is never silent. It marks the
 * fields, takes the person to the FIRST missing one in page order (inside its own form only),
 * and names what is missing in their own words — and a wiring mistake that makes any of that
 * impossible is reported, not swallowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';

const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...a: unknown[]) => showToast(...a),
}));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (e: unknown) => logEvent(e),
}));
const reveal = vi.fn();
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ pulse: vi.fn(), reveal: (el: unknown) => reveal(el) }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import {
  FORM_FIELD_ATTR,
  FORM_LABEL_ATTR,
  useFormValidation,
} from '@/composables/useFormValidation';

/** Every `logEvent` action emitted, in order. */
const actions = () => logEvent.mock.calls.map((c) => c[0].context?.action);

/** Mount a tiny form: each field a real FormFieldGroup bound through the composable. */
function mountForm(fields: { key: string; label: string; valid: () => boolean }[], name = 'test') {
  let v!: ReturnType<typeof useFormValidation<string>>;
  const Form = defineComponent({
    setup() {
      v = useFormValidation(name, () => Object.fromEntries(fields.map((f) => [f.key, f.valid])));
      return () =>
        h(
          'form',
          fields.map((f) =>
            h(FormFieldGroup, { label: f.label, ...v.bind(f.key) }, () => h('input'))
          )
        );
    },
  });
  const wrapper = mount(Form, { attachTo: document.body });
  return { wrapper, v: () => v };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('useFormValidation — state', () => {
  it('needs no Pinia to be created and to answer what is missing', () => {
    // Setup must not touch i18n: only the paths that SHOW text resolve a translator.
    setActivePinia(undefined as never);
    const name = ref('');
    const v = useFormValidation('bare', () => ({ name: () => name.value.length > 0 }));
    expect(v.canSave.value).toBe(false);
    expect([...v.missing.value]).toEqual(['name']);
    name.value = 'Ollie';
    expect(v.canSave.value).toBe(true);
  });

  it('requires a field only while it has a rule, and the asterisk follows', () => {
    const recurring = ref(false);
    const v = useFormValidation('cond', () => ({
      title: () => true,
      ...(recurring.value ? { schedule: () => false } : {}),
    }));
    expect(v.isRequired('schedule')).toBe(false);
    expect(v.canSave.value).toBe(true);
    recurring.value = true;
    expect(v.isRequired('schedule')).toBe(true);
    expect(v.canSave.value).toBe(false);
  });

  it('does not claim a requirement for a rule left undefined', () => {
    const v = useFormValidation<'a'>('undef', () => ({ a: undefined }));
    expect(v.isRequired('a')).toBe(false);
    expect(v.canSave.value).toBe(true);
  });

  it('shows no error before a Save is tried, and every missing one after', async () => {
    const v = useFormValidation('gate', () => ({ a: () => false, b: () => true }));
    expect(v.showError('a')).toBe(false);
    await v.attemptSave(() => undefined);
    expect(v.showError('a')).toBe(true);
    expect(v.showError('b')).toBe(false);
    expect(v.bind('a')).toMatchObject({ error: true, errorMessage: 'validation.required' });
  });

  it('treats a throwing rule as missing and reports it ONCE, however often it recomputes', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tick = ref(0);
    const v = useFormValidation('boom', () => ({
      a: () => {
        void tick.value;
        throw new Error('bad rule');
      },
    }));
    expect(v.missing.value.has('a')).toBe(true);
    tick.value++;
    expect(v.missing.value.has('a')).toBe(true);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]![0]).toBe(
      '[useFormValidation:boom] rule "a" threw — fix the rule predicate:'
    );
    expect(actions()).toEqual(['rule_threw']);
    err.mockRestore();
  });

  it('resets itself every time the drawer opens', async () => {
    const open = ref(true);
    const v = useFormValidation('reopen', () => ({ a: () => false }), { open: () => open.value });
    await v.attemptSave(() => undefined);
    expect(v.showError('a')).toBe(true);
    open.value = false;
    await nextTick();
    open.value = true;
    await nextTick();
    expect(v.showError('a')).toBe(false);
  });
});

describe('useFormValidation — an invalid Save is never silent', () => {
  it('takes the person to the FIRST missing field in page order, not rule order', async () => {
    const { v } = mountForm([
      { key: 'title', label: 'Title', valid: () => true },
      { key: 'date', label: 'Date', valid: () => false },
      { key: 'who', label: "Who's going?", valid: () => false },
    ]);
    const onValid = vi.fn();
    await v().attemptSave(onValid);

    expect(onValid).not.toHaveBeenCalled();
    const target = reveal.mock.calls[0]![0] as HTMLElement;
    expect(target.getAttribute(FORM_LABEL_ATTR)).toBe('Date');
    // `t` is mocked to its key, so the message is the (filled) key itself.
    expect(showToast).toHaveBeenCalledWith('info', 'form.missing.title', 'form.missing.message');
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('names every missing field by its own on-screen label (the attribute contract)', async () => {
    // A real FormFieldGroup (the label) next to a v.hook target (an explicit label). Renaming
    // either attribute on either side breaks this, rather than silently breaking the toast.
    const fillSpy = await import('@/utils/fillTemplate');
    const spy = vi.spyOn(fillSpy, 'fillTemplate');
    let v!: ReturnType<typeof useFormValidation<'x' | 'y'>>;
    const Form = defineComponent({
      setup() {
        v = useFormValidation('contract', () => ({ x: () => false, y: () => false }));
        return () =>
          h('div', [
            h(FormFieldGroup, { label: 'Trip Name', ...v.bind('x') }, () => h('input')),
            h('p', v.hook('y', 'Exchange Rates'), 'no rate'),
          ]);
      },
    });
    mount(Form, { attachTo: document.body });
    await v.attemptSave(() => undefined);

    expect(document.querySelectorAll(`[${FORM_FIELD_ATTR}]`)).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith('form.missing.message', {
      fields: 'Trip Name, Exchange Rates',
    });
    spy.mockRestore();
  });

  it('lets bind() override a question-shaped group label with a noun', async () => {
    let v!: ReturnType<typeof useFormValidation<'trip'>>;
    const Form = defineComponent({
      setup() {
        v = useFormValidation('override', () => ({ trip: () => false }));
        return () =>
          h(FormFieldGroup, { label: 'Add to which trip?', ...v.bind('trip', 'Trip') }, () =>
            h('select')
          );
      },
    });
    mount(Form, { attachTo: document.body });
    await v.attemptSave(() => undefined);
    const target = reveal.mock.calls[0]![0] as HTMLElement;
    expect(target.getAttribute(FORM_LABEL_ATTR)).toBe('Trip');
  });

  it('never reaches into another open form', async () => {
    // Drawers stack: a list drawer over the activity drawer. Both have a "title".
    const under = mountForm([{ key: 'title', label: 'Under', valid: () => false }], 'under');
    const over = mountForm([{ key: 'title', label: 'Over', valid: () => false }], 'over');
    await over.v().attemptSave(() => undefined);
    const target = reveal.mock.calls[0]![0] as HTMLElement;
    expect(target.getAttribute(FORM_LABEL_ATTR)).toBe('Over');
    expect(under.v().showError('title')).toBe(false);
  });

  it('reports a missing field that has nowhere to scroll, and still tells the person', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const v = useFormValidation('unhooked', () => ({ ghost: () => false }));
    await v.attemptSave(() => undefined);
    expect(actions()).toEqual(['target_missing', 'blocked']);
    expect(warn.mock.calls[0]![0]).toContain(`v-bind="v.bind('ghost')"`);
    // No label found: the title alone still says something is missing.
    expect(showToast).toHaveBeenCalledWith('info', 'form.missing.title', undefined);
    warn.mockRestore();
  });

  it('logs blocked, then recovered exactly once when the next Save passes', async () => {
    const ok = ref(false);
    const { v } = mountForm([{ key: 'a', label: 'A', valid: () => ok.value }], 'recover');
    await v().attemptSave(() => undefined);
    ok.value = true;
    await v().attemptSave(() => undefined);
    await v().attemptSave(() => undefined);
    expect(actions()).toEqual(['blocked', 'recovered', 'passed']);
    const blocked = logEvent.mock.calls[0]![0];
    expect(blocked).toMatchObject({
      surface: 'form-validation',
      context: { action: 'blocked', kind: 'recover', error_code: 'a' },
    });
  });

  it('logs passed on a first-time valid save, so the blocked rate has a denominator', async () => {
    const v = useFormValidation('first', () => ({ a: () => true }));
    await v.attemptSave(() => undefined);
    expect(actions()).toEqual(['passed']);
  });

  it('does not count a save with no rules (a later wizard step) as passed', async () => {
    const v = useFormValidation('empty', () => ({}));
    await v.attemptSave(() => undefined);
    expect(actions()).toEqual([]);
  });

  it('attributes a block to the field it scrolled to, not the first rule', async () => {
    let v!: ReturnType<typeof useFormValidation<'amount' | 'description'>>;
    const Form = defineComponent({
      setup() {
        // Rule order: amount first. Page order: description first.
        v = useFormValidation('order', () => ({ amount: () => false, description: () => false }));
        return () =>
          h('div', [
            h(FormFieldGroup, { label: 'Description', ...v.bind('description') }, () => h('input')),
            h(FormFieldGroup, { label: 'Amount', ...v.bind('amount') }, () => h('input')),
          ]);
      },
    });
    mount(Form, { attachTo: document.body });
    await v.attemptSave(() => undefined);
    expect(logEvent.mock.calls.at(-1)![0].context).toMatchObject({
      action: 'blocked',
      error_code: 'description',
    });
  });

  it('runs the save when valid, and lets its errors reach the drawer', async () => {
    const v = useFormValidation('ok', () => ({ a: () => true }));
    await expect(v.attemptSave(() => 'saved')).resolves.toBe('saved');
    await expect(
      v.attemptSave(() => {
        throw new Error('drive down');
      })
    ).rejects.toThrow('drive down');
    expect(showToast).not.toHaveBeenCalled();
  });
});
