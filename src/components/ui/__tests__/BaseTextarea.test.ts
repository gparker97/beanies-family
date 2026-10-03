/**
 * BaseTextarea's exposed `focus()` (#119). A host that owns focus (the quick-add composer, the
 * magic-beans drawer) calls it instead of reaching into the child's DOM with `querySelector`.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';

describe('BaseTextarea focus()', () => {
  it('focuses the inner <textarea> and reports that it could', () => {
    const w = mount(BaseTextarea, { props: { modelValue: '' }, attachTo: document.body });
    const focused = (w.vm as unknown as { focus: () => boolean }).focus();
    expect(focused).toBe(true);
    expect(document.activeElement).toBe(w.find('textarea').element);
    w.unmount();
  });

  it('forwards extra attributes to the <textarea>, not the wrapper', () => {
    const w = mount(BaseTextarea, {
      props: { modelValue: '' },
      attrs: { 'data-testid': 'field', 'aria-label': 'Paste anything' },
    });
    const ta = w.find('textarea');
    expect(ta.attributes('data-testid')).toBe('field');
    expect(ta.attributes('aria-label')).toBe('Paste anything');
  });
});
