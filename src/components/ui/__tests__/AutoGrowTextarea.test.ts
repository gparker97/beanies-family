/**
 * The auto-growing one-line textarea (#116, extracted from the magic to-do drawer).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import AutoGrowTextarea from '../AutoGrowTextarea.vue';

function mounted(value = 'Return slip') {
  const w = mount(AutoGrowTextarea, {
    props: {
      modelValue: value,
      wrapperClass: 'text-sm font-semibold',
      'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }),
    },
    attrs: { 'aria-label': 'Title', 'data-testid': 'title', class: 'bg-transparent' },
  });
  return w;
}

describe('AutoGrowTextarea', () => {
  it('puts attributes on the textarea and the font on the wrapper', () => {
    const w = mounted();
    const ta = w.find('textarea');
    expect(ta.attributes('aria-label')).toBe('Title');
    expect(ta.attributes('data-testid')).toBe('title');
    expect(ta.classes()).toContain('bg-transparent');
    expect(w.classes()).toContain('text-sm');
    expect(w.attributes('aria-label')).toBeUndefined();
  });

  it('mirrors the value (plus a trailing space) so the grid cell grows with it', async () => {
    const w = mounted();
    expect(w.attributes('data-value')).toBe('Return slip ');
    await w.find('textarea').setValue('Return slip by Friday');
    expect(w.props('modelValue')).toBe('Return slip by Friday');
    expect(w.attributes('data-value')).toBe('Return slip by Friday ');
  });

  it('blocks Enter and says so, but not while an IME is composing', () => {
    const w = mounted();
    const ta = w.find('textarea').element;
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    ta.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(w.emitted('enter')).toHaveLength(1);

    const composing = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
      isComposing: true,
    });
    ta.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    expect(w.emitted('enter')).toHaveLength(1);
  });

  describe('singleLine', () => {
    function singleLine(value: string, singleLine = true) {
      const w = mount(AutoGrowTextarea, {
        props: {
          modelValue: value,
          singleLine,
          'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }),
        },
      });
      return w;
    }

    /** jsdom has no ClipboardEvent constructor with data, so build the event by hand. */
    function paste(el: HTMLElement, text: string): Event {
      const ev = new Event('paste', { cancelable: true, bubbles: true });
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
      el.dispatchEvent(ev);
      return ev;
    }

    it('a pasted line break becomes a space AT THE CARET, and the caret stays after it', async () => {
      const w = singleLine('Milk bread');
      const ta = w.find('textarea').element as HTMLTextAreaElement;
      ta.setSelectionRange(5, 5); // "Milk |bread"
      const ev = paste(ta, 'and\r\nbutter\n\n');
      await nextTick();
      expect(ev.defaultPrevented).toBe(true);
      expect(w.props('modelValue')).toBe('Milk and butter bread');
      expect(ta.value).toBe('Milk and butter bread');
      expect(ta.selectionStart).toBe('Milk and butter '.length);
    });

    it('replaces a selection, and leaves a paste with no line break to the browser', async () => {
      const w = singleLine('Milk bread');
      const ta = w.find('textarea').element as HTMLTextAreaElement;
      ta.setSelectionRange(0, 4); // "Milk"
      paste(ta, 'Oat\nmilk');
      await nextTick();
      expect(w.props('modelValue')).toBe('Oat milk bread');
      const plain = paste(ta, 'jam');
      expect(plain.defaultPrevented).toBe(false);
    });

    it('a soft keyboard line break (no Enter keydown) is blocked and emits enter', () => {
      const w = singleLine('Milk');
      const ta = w.find('textarea').element;
      for (const inputType of ['insertLineBreak', 'insertParagraph']) {
        const ev = new InputEvent('beforeinput', { inputType, cancelable: true });
        ta.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
      }
      expect(w.emitted('enter')).toHaveLength(2);
      const typing = new InputEvent('beforeinput', { inputType: 'insertText', cancelable: true });
      ta.dispatchEvent(typing);
      expect(typing.defaultPrevented).toBe(false);
    });

    it('off by default: paste and line-break input are left to the caller', () => {
      const w = singleLine('Milk', false);
      const ta = w.find('textarea').element;
      expect(paste(ta, 'a\nb').defaultPrevented).toBe(false);
      const ev = new InputEvent('beforeinput', { inputType: 'insertLineBreak', cancelable: true });
      ta.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
      expect(w.emitted('enter')).toBeUndefined();
    });
  });

  it('forwards listeners such as blur to the textarea', async () => {
    let blurred = 0;
    const w = mount(AutoGrowTextarea, {
      props: { modelValue: 'x' },
      attrs: { onBlur: () => blurred++ },
    });
    await w.find('textarea').trigger('blur');
    expect(blurred).toBe(1);
  });
});
