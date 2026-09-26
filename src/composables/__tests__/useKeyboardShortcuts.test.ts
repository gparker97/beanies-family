import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { lockBodyScroll, resetOverlayStack } from '@/utils/overlayStack';
import { useEscapeClose, __resetEscapeCloseForTests } from '@/composables/useEscapeClose';

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

let scope: ReturnType<typeof effectScope>;
const k = vi.fn(() => true);
const enabled = ref(true);

beforeEach(() => {
  vi.clearAllMocks();
  enabled.value = true;
  resetOverlayStack();
  __resetEscapeCloseForTests();
  scope = effectScope();
  scope.run(() => useKeyboardShortcuts({ k, arrowleft: k }, { enabled, tag: 'test' }));
});
afterEach(() => {
  scope.stop();
  document.body.innerHTML = '';
});

describe('useKeyboardShortcuts', () => {
  it('runs the handler for a key, case-insensitively, and prevents the default', async () => {
    const e = press('K');
    press('ArrowLeft');
    await flush();
    expect(k).toHaveBeenCalledTimes(2);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves unmapped keys alone', () => {
    const e = press('x');
    expect(e.defaultPrevented).toBe(false);
  });

  it('keeps the default when the handler says it did nothing', () => {
    const noop = vi.fn(() => false);
    const s = effectScope();
    s.run(() => useKeyboardShortcuts({ arrowright: noop }, { enabled: true, tag: 'test' }));
    const e = press('ArrowRight');
    expect(noop).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
    s.stop();
  });

  it('prevents the default for a handler that started async work', () => {
    const s = effectScope();
    s.run(() =>
      useKeyboardShortcuts({ p: () => Promise.resolve() }, { enabled: true, tag: 'test' })
    );
    expect(press('p').defaultPrevented).toBe(true);
    s.stop();
  });

  it('acts whatever button has focus, e.g. the page-level toggle that opened the surface', async () => {
    const toggle = document.createElement('button');
    document.body.appendChild(toggle);
    toggle.focus();
    const e = press('k');
    press('ArrowLeft');
    await flush();
    expect(k).toHaveBeenCalledTimes(2);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves arrows to a focused widget that uses them, but still takes letters there', async () => {
    for (const make of [
      () => {
        const el = document.createElement('div');
        el.setAttribute('role', 'slider');
        el.tabIndex = 0;
        return el;
      },
      () => {
        const list = document.createElement('div');
        list.setAttribute('role', 'tablist');
        const tab = document.createElement('button');
        tab.setAttribute('role', 'tab');
        list.appendChild(tab);
        document.body.appendChild(list);
        return tab;
      },
      () => {
        const el = document.createElement('input');
        el.type = 'range';
        return el;
      },
    ]) {
      const el = make();
      if (!el.isConnected) document.body.appendChild(el);
      el.focus();
      const arrow = press('ArrowLeft');
      expect(arrow.defaultPrevented).toBe(false);
      el.remove();
    }
    expect(k).not.toHaveBeenCalled();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.tabIndex = 0;
    document.body.appendChild(menu);
    menu.focus();
    press('k');
    await flush();
    expect(k).toHaveBeenCalledTimes(1);
  });

  it('ignores repeats, modifiers, and a disabled surface', async () => {
    press('k', { repeat: true });
    press('k', { ctrlKey: true });
    press('k', { metaKey: true });
    press('k', { altKey: true });
    enabled.value = false;
    press('k');
    await flush();
    expect(k).not.toHaveBeenCalled();
  });

  it('ignores keys while typing in an input or a contenteditable', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press('k');
    input.blur();
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    div.focus();
    // jsdom does not implement isContentEditable; stand it in.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    press('k');
    await flush();
    expect(k).not.toHaveBeenCalled();
  });

  it('ignores keys while a modal / drawer or an Escape layer is open', async () => {
    lockBodyScroll();
    press('k');
    resetOverlayStack();
    const inner = effectScope();
    inner.run(() => useEscapeClose(ref(true), () => {}));
    press('k');
    await flush();
    expect(k).not.toHaveBeenCalled();
    inner.stop();
    press('k');
    await flush();
    expect(k).toHaveBeenCalledTimes(1);
  });

  it('logs a throwing or rejecting handler and reports it through onError', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const s = effectScope();
    s.run(() =>
      useKeyboardShortcuts(
        {
          t: () => {
            throw new Error('boom');
          },
          r: () => Promise.reject(new Error('nope')),
        },
        { enabled: true, tag: 'test', onError }
      )
    );
    press('t');
    press('r');
    await flush();
    expect(err).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map((c) => c[0])).toEqual(['t', 'r']);
    s.stop();
    err.mockRestore();
  });

  it('removes the listener when the scope is disposed', async () => {
    scope.stop();
    press('k');
    await flush();
    expect(k).not.toHaveBeenCalled();
  });
});
