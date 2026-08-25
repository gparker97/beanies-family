/**
 * Every form field in the app must announce its own name.
 *
 * The label had no `for` and the control sits in a sibling slot, so nothing associated them
 * and a screen reader read every field as "edit, blank" — airline, flight number, terminal
 * and booking reference all identical, on a field set that swaps by trip type so counting
 * positions does not help either.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import FormFieldGroup from '../FormFieldGroup.vue';

describe('FormFieldGroup accessibility', () => {
  it('associates the label with a plain slotted input', () => {
    const w = mount(FormFieldGroup, {
      props: { label: 'Flight Number' },
      slots: { default: '<input />' },
      attachTo: document.body,
    });
    const input = w.find('input');
    const labelId = w.find('label').attributes('id');
    expect(labelId).toBeTruthy();
    expect(input.attributes('aria-labelledby')).toBe(labelId);
  });

  it('associates through a WRAPPER component, not just a bare input', () => {
    // The real shape: BaseInput/BaseSelect render the control themselves, which is why an
    // id-threading fix would have meant touching every call site.
    const Wrapper = defineComponent({ setup: () => () => h('div', [h('input')]) });
    const w = mount(FormFieldGroup, {
      props: { label: 'Airline' },
      slots: { default: h(Wrapper) },
      attachTo: document.body,
    });
    expect(w.find('input').attributes('aria-labelledby')).toBe(w.find('label').attributes('id'));
  });

  it('labels a textarea and a select too', () => {
    for (const tag of ['<textarea></textarea>', '<select><option>a</option></select>']) {
      const w = mount(FormFieldGroup, {
        props: { label: 'Notes' },
        slots: { default: tag },
        attachTo: document.body,
      });
      const el = w.find(tag.startsWith('<textarea') ? 'textarea' : 'select');
      expect(el.attributes('aria-labelledby')).toBe(w.find('label').attributes('id'));
    }
  });

  it('does NOT override a control that is already labelled', () => {
    const w = mount(FormFieldGroup, {
      props: { label: 'Outer' },
      slots: { default: '<input aria-label="Inner label" />' },
      attachTo: document.body,
    });
    expect(w.find('input').attributes('aria-labelledby')).toBeUndefined();
    expect(w.find('input').attributes('aria-label')).toBe('Inner label');
  });

  it('re-associates when the field is swapped by v-if', async () => {
    // The travel drawers replace their whole field set when the segment type changes, so a
    // one-shot onMounted would leave the new control unlabelled.
    const show = ref(true);
    const Host = defineComponent({
      setup: () => () =>
        h(
          FormFieldGroup,
          { label: 'Swapped' },
          {
            default: () =>
              show.value ? h('input', { class: 'a' }) : h('textarea', { class: 'b' }),
          }
        ),
    });
    const w = mount(Host, { attachTo: document.body });
    const labelId = w.find('label').attributes('id');
    expect(w.find('input.a').attributes('aria-labelledby')).toBe(labelId);
    show.value = false;
    await w.vm.$nextTick();
    expect(w.find('textarea.b').attributes('aria-labelledby')).toBe(labelId);
  });

  it('gives each group its OWN id within one form, so two fields are not conflated', () => {
    // Mounted in a SINGLE app, which is the real case — `useId` counts per app instance, so
    // two separate mount() calls would each restart the counter and collide harmlessly in a
    // way production never sees.
    const Form = defineComponent({
      setup: () => () =>
        h('div', [
          h(FormFieldGroup, { label: 'Airline' }, { default: () => h('input', { class: 'x' }) }),
          h(
            FormFieldGroup,
            { label: 'Flight Number' },
            { default: () => h('input', { class: 'y' }) }
          ),
        ]),
    });
    const w = mount(Form, { attachTo: document.body });
    const labels = w.findAll('label').map((l) => l.attributes('id'));
    expect(labels[0]).not.toBe(labels[1]);
    expect(w.find('input.x').attributes('aria-labelledby')).toBe(labels[0]);
    expect(w.find('input.y').attributes('aria-labelledby')).toBe(labels[1]);
  });
});
